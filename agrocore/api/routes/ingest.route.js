"use strict";

/**
 * agrocore/api/routes/ingest.route.js (ESM)
 *
 * ingest_route_v30_qc_hybrid_impact_optimizer_2026-03-15
 *
 * WHY v30:
 * - keeps v29 ingest/PDF logic intact
 * - fixes QC impact route to use hybrid formula baselines:
 *   nutrient_profile_full / nutrient_profile / calculated_nutrients first,
 *   then nutrient_constraints fallback
 * - fixes formula impact classification so tiny/noise changes do not become Risk
 * - fixes send-to-optimizer so payload always includes ingredient_pool
 * - preserves all existing QC routes, override flow, audit flow, and ingest behavior
 */

import express from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import pdfParse from "pdf-parse";
import xlsx from "xlsx";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = require("path").dirname(__filename);

const router = express.Router();

const INGEST_ROUTE_VERSION =
  "ingest_route_v30_qc_hybrid_impact_optimizer_2026-03-15";

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 5);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const INGEST_DEBUG = String(process.env.INGEST_DEBUG || "") === "1";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

function toNum(str) {
  if (str == null) return null;
  const s = String(str).replace(/,/g, "").replace(/[^\d.\-]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function norm(text) {
  return String(text || "").replace(/[ \t]{2,}/g, " ").trim();
}

function lc(s) {
  return String(s || "").toLowerCase().trim();
}

function alphaCount(s) {
  const m = String(s || "").match(/[a-z]/gi);
  return m ? m.length : 0;
}

function isPureNumberName(name) {
  return /^[0-9]+(\.[0-9]+)?$/.test(String(name || "").trim());
}

function degluePdfText(raw) {
  let t = String(raw || "");
  t = t.replace(/\u00A0/g, " ");
  t = t.replace(/([A-Za-z])([0-9])/g, "$1 $2");
  t = t.replace(/([0-9])([A-Za-z])/g, "$1 $2");
  t = t.replace(/(%)(\d)/g, "$1 $2"); // fix: "SBM 46%15.80" -> "SBM 46% 15.80"

  for (let i = 0; i < 3; i++) {
    t = t.replace(/(\d\.\d+)(?=\d+\.)/g, "$1 ");
  }

  t = t.replace(/(\d)\.(\s|$)/g, "$1$2");
  t = t.replace(/[ \t]{2,}/g, " ");
  return t;
}

const HARD_JUNK_SUBSTR = [
  "values",
  "min",
  "max",
  "target",
  "actual",
  "weight",
  "rates",
  "rate",
  "cost",
  "bag",
  "kg",
  "rs",
  "codes",
  "remarks",
  "date",
  "plant",
  "formula",
  "summary",
  "profile",
  "nutrition",
  "nutrients",
  "non-abbr",
  "low",
];

const NUTRIENT_WORDS = [
  "nfe",
  "ash",
  "cf",
  "ee",
  "fat",
  "fiber",
  "fibre",
  "dm",
  "cp",
  "me",
  "ca",
  "na",
  "k",
  "cl",
  "avp",
  "deb",
  "p",
];

function looksJunky(name) {
  const n = lc(name);
  if (!n) return true;

  if (n.startsWith("=>")) return true;
  if (/^[a-z]$/.test(n)) return true;

  if (n.startsWith("total")) return true;
  if (n.startsWith("av. p")) return true;
  if (n.includes("av. p")) return true;
  if (n.includes("non-abbr")) return true;
  if (n === "low" || n.startsWith("low ")) return true;

  if (isPureNumberName(n)) return true;
  if (n === "x") return true;

  for (const bad of HARD_JUNK_SUBSTR) {
    if (n.includes(bad)) return true;
  }

  if (NUTRIENT_WORDS.includes(n)) return true;

  const compact = n.replace(/\s+/g, "");
  for (const w of NUTRIENT_WORDS) {
    if (compact === w) return true;
    if (compact.startsWith(w) && /[0-9]/.test(compact.slice(w.length))) {
      return true;
    }
  }

  if (alphaCount(n) < 3) return true;

  return false;
}

function extractReportedFromPdfText(text) {
  const t = norm(text);

  function grab(labelRe) {
  const re = new RegExp(`${labelRe.source}\\s*([0-9,]+(?:\\.[0-9]+)?)`, "i");
  const m = t.match(re);
  return m ? toNum(String(m[1]).replace(/,/g, "")) : null;
}

  const out = {};
  const total = grab(/\bTotal\b/);
  const reported_total =
    total != null && total > 50 && total < 150 ? total : null;

  out.dm = grab(/\bDM\b/);
 out.me = grab(/ME/);
out.cp = grab(/CP/);
out.ca = grab(/Ca/);
out.avp = grab(/Av\.?\s*P/);
  out.na = grab(/\bNa\b/);
  out.k = grab(/\bK\b/);
  out.cl = grab(/\bCl\b/);
  out.deb = grab(/\bDEB\b/);

  out.sid_met = grab(/\bMeth\s*\(D\)\b/);
  out.sid_lys = grab(/\bLysine\s*\(D\)\b/);
  out.sid_thr = grab(/\bThreo\s*\(D\)\b/);
  out.sid_trp = grab(/\bTryp\s*\(D\)\b/);
  out.sid_arg = grab(/\bArg\s*\(D\)\b/);
  out.sid_metcys = grab(/\bM\+C\s*\(D\)\b/);

  for (const k of Object.keys(out)) {
    if (out[k] == null) delete out[k];
  }

  return { reported_nutrients: out, reported_total };
}

let resolveAlias = null;
function getResolveAlias() {
  if (resolveAlias) return resolveAlias;
  const mod = require("../../../core/aliases/resolveAlias.cjs");
  resolveAlias = mod.resolveAlias;
  return resolveAlias;
}

function cleanName(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[%]/g, "")
    .replace(/[(),]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ");
}

const FALLBACK_CANONICAL = {
  "maize": "corn_grain_avg",
  "maize grain": "corn_grain_avg",
  "corn": "corn_grain_avg",
  "corn grain": "corn_grain_avg",
  "corn grain average": "corn_grain_avg",
  "corn, grain (average)": "corn_grain_avg",

  "sbm": "soybean_meal_44_5_cp",
  "sbm 44": "soybean_meal_44_5_cp",
  "sbm 44%": "soybean_meal_44_5_cp",
  "soybean meal": "soybean_meal_44_5_cp",
  "soybean meal 44": "soybean_meal_44_5_cp",
  "soybean meal 44 cp": "soybean_meal_44_5_cp",
  "soybean meal 44.5": "soybean_meal_44_5_cp",
  "soybean meal 44.5 cp": "soybean_meal_44_5_cp",

  "rice broken": "rice_broken",
  "broken rice": "rice_broken",

  "fish meal": "fish_meal_54_cp",
  "fish meal 54": "fish_meal_54_cp",
  "fish meal 54%": "fish_meal_54_cp",
  "fishmeal": "fish_meal_54_cp",
  "fishmeal 54": "fish_meal_54_cp",

  "millet bajra": "millet_grain",
  "millet/bajra": "millet_grain",
  "millet": "millet_grain",
  "bajra": "millet_grain",

  "soyabean oil": "soy_oil",
  "soybean oil": "soy_oil",
  "soya oil": "soy_oil",
  "soy oil": "soy_oil",
  "vegetable oil": "soy_oil",
  "oil": "soy_oil",

  "canola meal": "canola_meal",
  "canola meal 36": "canola_meal",
  "canola meal 36%": "canola_meal",
  "canola 36": "canola_meal",

  "sunflower meal": "sunflower_meal",
  "sunflower meal 26-28": "sunflower_meal",
  "sunflower meal 26 28": "sunflower_meal",
  "sunflower meal 26-28%": "sunflower_meal",

  "dlm": "dl_met",
  "dlm 99": "dl_met",
  "dlm 99%": "dl_met",
  "dl met": "dl_met",
  "dl-methionine": "dl_met",

  "c.g": "corn_gluten_meal_60_cp",
  "c g": "corn_gluten_meal_60_cp",
  "c g 60": "corn_gluten_meal_60_cp",
  "c g 60%": "corn_gluten_meal_60_cp",
  "c.g 60": "corn_gluten_meal_60_cp",
  "c.g 60%": "corn_gluten_meal_60_cp",
  "cg": "corn_gluten_meal_60_cp",
  "cg 60": "corn_gluten_meal_60_cp",
  "cg 60%": "corn_gluten_meal_60_cp",
  "corn gluten": "corn_gluten_meal_60_cp",
  "corn gluten meal": "corn_gluten_meal_60_cp",
  "corn gluten meal 60": "corn_gluten_meal_60_cp",
  "corn gluten meal 60%": "corn_gluten_meal_60_cp",

  "salt": "salt",
  "salt nacl": "salt",
  "salt (nacl)": "salt",
  "nacl": "salt",

  "choline chloride": "choline_chloride",

  "vitamin premix": "vitamin_premix",
  "mineral premix": "mineral_premix",
  "anti coccidial": "anti_coccidial",
  "anti-coccidial": "anti_coccidial",
  "toxin binder": "toxin_binder",

  "phytase": "phytase",
  "protease": "protease",
  "nsps": "nsps",
  "agps": "agps",

  "phytase 5000": "phytase",
  "phytase 10000": "phytase",
  "protease enzyme": "protease",
  "nsps enzyme": "nsps",
  "nsp": "nsps",
  "agp": "agps",
  "antibiotic growth promoter": "agps",

  // ── Maize / Corn ──────────────────────────────────────────────
  "maize/corn": "corn_grain_avg",
  "corn/maize": "corn_grain_avg",
  "maize grain": "corn_grain_avg",
  "corn grain": "corn_grain_avg",

  // ── RSM / Rapeseed / Canola ───────────────────────────────────
  "rsm": "canola_meal",
  "rsm 36": "canola_meal",
  "rsm 34": "canola_meal",
  "rsm 36%": "canola_meal",
  "rapeseed meal": "canola_meal",
  "rape seed meal": "canola_meal",
  "rapeseed": "canola_meal",

  // ── APC — kept as their own distinct IDs ──────────────────────
  "apc": "animal_protein_concentrate_55_cp",
  "apc 55": "animal_protein_concentrate_55_cp",
  "apc 55%": "animal_protein_concentrate_55_cp",
  "apc 65": "animal_protein_concentrate_65_cp",
  "apc 65%": "animal_protein_concentrate_65_cp",
  "animal protein concentrate": "animal_protein_concentrate_55_cp",
  "animal protein concentrate 55": "animal_protein_concentrate_55_cp",
  "animal protein concentrate 55%": "animal_protein_concentrate_55_cp",
  "animal protein concentrate 65": "animal_protein_concentrate_65_cp",
  "animal protein concentrate 65%": "animal_protein_concentrate_65_cp",

  // ── Lysine Sulphate — distinct from L-Lys HCl ────────────────
  "lysine sulphate": "l_lys_sulfate",
  "lysine sulfate": "l_lys_sulfate",
  "lysine sulphate 70": "l_lys_sulfate",
  "lysine sulphate 70%": "l_lys_sulfate",
  "l-lysine sulphate": "l_lys_sulfate",
  "l lysine sulphate": "l_lys_sulfate",
  "lys sulphate": "l_lys_sulfate",
  "lys sulfate": "l_lys_sulfate",
  "l lys sulfate": "l_lys_sulfate",

  // ── Sodium Bicarbonate / Soda ─────────────────────────────────
  "soda": "sodium_bicarbonate",
  "soda ash": "sodium_bicarbonate",
  "sodium bicarb": "sodium_bicarbonate",
  "sodium bicarbonate": "sodium_bicarbonate",
  "bicarb": "sodium_bicarbonate",
  "nahco3": "sodium_bicarbonate",

  // ── Limestone / Calcium Carbonate ────────────────────────────
  "lime stone": "limestone",
  "limestone": "limestone",
  "calcium carbonate": "limestone",
  "calcium_carbonate": "limestone",
  "lime": "limestone",
  "calcite": "limestone",

  // ── Vit + Min Premix ─────────────────────────────────────────
  "vit + min premix": "vit_min_premix",
  "vit+min premix": "vit_min_premix",
  "vit min premix": "vit_min_premix",
  "vitamin mineral premix": "vit_min_premix",
  "vit mineral premix": "vit_min_premix",
  "vitamin + mineral premix": "vit_min_premix",
  "vitamin and mineral premix": "vit_min_premix",
  "v+m premix": "vit_min_premix",
  "vm premix": "vit_min_premix",

  // ── L-Valine ─────────────────────────────────────────────────
  "l-valine": "l_val",
  "l valine": "l_val",
  "lvaline": "l_val",
  "l_valine": "l_val",
  "valine": "l_val",

  // ── L-Tryptophan ─────────────────────────────────────────────
  "l-tryptophan": "l_trp",
  "l tryptophan": "l_trp",
  "ltryptophan": "l_trp",
  "l_tryptophan": "l_trp",
  "tryptophan": "l_trp",

  // ── Coccidiostats / Additives ─────────────────────────────────
  "genphase broiler": "anti_coccidial",
  "genphase": "anti_coccidial",
  "salinomycin": "anti_coccidial",
  "monensin": "anti_coccidial",
  "diclazuril": "anti_coccidial",
  "narasin": "anti_coccidial",
  "coccidiostat": "anti_coccidial"
};

function normalizeDisplayName(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/[%]/g, "");
  s = s.replace(/[ \t]{2,}/g, " ");
  return s.trim();
}

function tryResolveToCanonical(rawName) {
  try {
    const ra = getResolveAlias();
    const cleaned = cleanName(rawName);

    const r = ra(cleaned);
    const canonical = r?.canonical_key || null;

    if (canonical) {
      if (INGEST_DEBUG) {
        console.log("[DBG alias]", {
          raw: rawName,
          cleaned,
          canonical,
          via: "resolveAlias",
        });
      }
      return canonical;
    }

    const fb = FALLBACK_CANONICAL[cleaned] || null;
if (INGEST_DEBUG) {
  console.log("[DBG fallback lookup]", { raw: rawName, cleaned, fb });
}
if (fb) {
  if (INGEST_DEBUG) {
    console.log("[DBG alias]", {
      raw: rawName,
      cleaned,
      canonical: fb,
      via: "fallback",
    });
  }
  return fb;
}

    if (INGEST_DEBUG) {
      console.log("[DBG alias MISS]", { raw: rawName, cleaned });
    }
    return null;
  } catch (e) {
    if (INGEST_DEBUG) {
      console.log("[DBG alias ERROR]", {
        raw: rawName,
        err: e?.message || String(e),
      });
    }
    return null;
  }
}

function tokenizeMatchText(text) {
  return cleanName(text)
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function scoreTextSimilarity(queryText, candidateTexts = []) {
  const q = cleanName(queryText);
  if (!q) return 0;

  let score = 0;
  const qTokens = tokenizeMatchText(q);

  for (const rawCandidate of candidateTexts) {
    const c = cleanName(rawCandidate);
    if (!c) continue;

    if (c === q) score = Math.max(score, 120);
    else if (c.startsWith(q)) score = Math.max(score, 95);
    else if (c.includes(q)) score = Math.max(score, 80);
    else if (q.includes(c) && c.length >= 4) score = Math.max(score, 70);

    const cTokens = tokenizeMatchText(c);
    let overlap = 0;
    for (const qt of qTokens) {
      if (cTokens.includes(qt)) overlap++;
      else if (cTokens.some((ct) => ct.startsWith(qt) || qt.startsWith(ct))) overlap++;
    }

    if (qTokens.length && overlap) {
      const ratio = overlap / qTokens.length;
      if (ratio >= 1) score = Math.max(score, 88);
      else if (ratio >= 0.66) score = Math.max(score, 76);
      else if (ratio >= 0.5) score = Math.max(score, 64);
    }
  }

  return score;
}
function resolveCanonicalQcIngredient({
  entered_name = "",
  matched_ingredient_id = "",
  matched_display_name = "",
  nutrients = {}
} = {}) {
  const db = loadIngredientMasterDb();

  const explicitId = String(matched_ingredient_id || "").trim();
  if (explicitId && db[explicitId] && typeof db[explicitId] === "object") {
    return explicitId;
  }

  const directTexts = [
    String(entered_name || "").trim(),
    String(matched_display_name || "").trim(),
    explicitId
  ].filter(Boolean);

  for (const text of directTexts) {
    const direct = tryResolveToCanonical(text);
    if (direct && db[direct] && typeof db[direct] === "object") {
      return direct;
    }
  }

  const queryText = String(entered_name || matched_display_name || explicitId || "").trim();
  if (!queryText) return null;

  const normalizedQuery = queryText.toLowerCase();

  const familyRules = [
    {
      keys: ["sbm", "soybean meal", "soybean_meal", "soya", "soy meal", "soymeal"],
      preferredIds: [
        "soybean_meal_48_cp",
        "soybean_meal_46_5_cp",
        "soybean_meal_45_6_cp",
        "soybean_meal_44_5_cp"
      ],
      match: (id) => /^soybean_meal_/i.test(id)
    },
    {
      keys: ["corn", "maize"],
      preferredIds: ["corn"],
      match: (id) => /^corn($|_)/i.test(id) || /^maize($|_)/i.test(id)
    },
    {
      keys: ["dcp", "dicalcium phosphate", "dicalcium_phosphate"],
      preferredIds: ["dcp", "dicalcium_phosphate"],
      match: (id) => /^dcp$/i.test(id) || /^dicalcium_phosphate$/i.test(id)
    },
    {
      keys: ["salt", "sodium chloride", "sodium_chloride"],
      preferredIds: ["salt", "sodium_chloride"],
      match: (id) => /^salt$/i.test(id) || /^sodium_chloride$/i.test(id)
    },
    {
      keys: ["oil", "vegetable oil", "vegetable_oil"],
      preferredIds: ["oil", "vegetable_oil"],
      match: (id) => /^oil$/i.test(id) || /^vegetable_oil$/i.test(id)
    },
    {
      keys: ["lys", "lysine", "l-lysine hcl", "l_lys_hcl"],
      preferredIds: ["l_lys_hcl"],
      match: (id) => /^l_lys_hcl$/i.test(id)
    },
    {
      keys: ["met", "methionine", "dl-methionine", "dl_met"],
      preferredIds: ["dl_met"],
      match: (id) => /^dl_met$/i.test(id)
    }
  ];

  for (const rule of familyRules) {
    if (!rule.keys.some((k) => normalizedQuery.includes(k))) continue;

    for (const pref of rule.preferredIds || []) {
      if (db[pref] && typeof db[pref] === "object") {
        return pref;
      }
    }

    const fallbackFamily = Object.keys(db).find((id) => rule.match(id));
    if (fallbackFamily) return fallbackFamily;
  }

  const cpHint = toNum(nutrients?.cp);
  const dmHint = toNum(nutrients?.dm);
  const moistureHint = toNum(nutrients?.moisture);

  let best = { id: null, score: -1 };

  for (const [id, row] of Object.entries(db || {})) {
    if (!row || typeof row !== "object") continue;

    const display = String(row.display_name || "").trim();
    const candidateProfile = toReviewNutrientProfile(row);
    let score = scoreTextSimilarity(queryText, [id, display]);

    if (cpHint != null && candidateProfile.cp != null) {
      const diff = Math.abs(cpHint - candidateProfile.cp);
      if (diff <= 0.5) score += 32;
      else if (diff <= 1.0) score += 24;
      else if (diff <= 2.0) score += 14;
      else if (diff <= 4.0) score += 6;
    }

    if (dmHint != null && candidateProfile.dm != null) {
      const diff = Math.abs(dmHint - candidateProfile.dm);
      if (diff <= 1.0) score += 10;
      else if (diff <= 2.5) score += 5;
    }

    if (moistureHint != null && candidateProfile.moisture != null) {
      const diff = Math.abs(moistureHint - candidateProfile.moisture);
      if (diff <= 1.0) score += 10;
      else if (diff <= 2.5) score += 5;
    }

    if (score > best.score) {
      best = { id, score };
    }
  }

  return best.score >= 60 ? best.id : null;
}

function getQcIngredientContext({
  entered_name = "",
  matched_ingredient_id = "",
  matched_display_name = "",
  nutrients = {}
} = {}) {
  const db = loadIngredientMasterDb();
  const canonical = resolveCanonicalQcIngredient({
    entered_name,
    matched_ingredient_id,
    matched_display_name,
    nutrients
  });

  const row = canonical && db[canonical] && typeof db[canonical] === "object"
    ? db[canonical]
    : null;

  return {
    ingredient_id: canonical || null,
    ingredient_row: row || null,
    matched_display_name:
      row?.display_name ||
      String(matched_display_name || "").trim() ||
      (entered_name ? normalizeDisplayName(entered_name) : "") ||
      canonical ||
      "",
    baseline_nutrients: row ? toReviewNutrientProfile(row) : {}
  };
}

function resolveDbIngredientContext(rawIngredientId, proposedProfile = {}) {
  const db = loadIngredientMasterDb();
  const raw = String(rawIngredientId || "").trim();

  if (raw && db[raw] && typeof db[raw] === "object") {
    return {
      ingredient_id: raw,
      row: db[raw]
    };
  }

  const normalized = normalizeQcNutrients(proposedProfile || {});
  const cpHint = toNum(normalized?.cp);
  const rawLower = raw.toLowerCase();

  const familyRules = [
    {
      keys: ["sbm", "soybean meal", "soybean_meal", "soya", "soy meal", "soymeal"],
      preferredIds: [
        "soybean_meal_48_cp",
        "soybean_meal_46_5_cp",
        "soybean_meal_45_6_cp",
        "soybean_meal_44_5_cp"
      ],
      match: (id) => /^soybean_meal_/i.test(id)
    },
    {
      keys: ["corn", "maize"],
      preferredIds: ["corn"],
      match: (id) => /^corn($|_)/i.test(id) || /^maize($|_)/i.test(id)
    },
    {
      keys: ["dcp", "dicalcium phosphate", "dicalcium_phosphate"],
      preferredIds: ["dcp", "dicalcium_phosphate"],
      match: (id) => /^dcp$/i.test(id) || /^dicalcium_phosphate$/i.test(id)
    },
    {
      keys: ["salt", "sodium chloride", "sodium_chloride"],
      preferredIds: ["salt", "sodium_chloride"],
      match: (id) => /^salt$/i.test(id) || /^sodium_chloride$/i.test(id)
    },
    {
      keys: ["oil", "vegetable oil", "vegetable_oil"],
      preferredIds: ["oil", "vegetable_oil"],
      match: (id) => /^oil$/i.test(id) || /^vegetable_oil$/i.test(id)
    },
    {
      keys: ["lys", "lysine", "l-lysine hcl", "l_lys_hcl"],
      preferredIds: ["l_lys_hcl"],
      match: (id) => /^l_lys_hcl$/i.test(id)
    },
    {
      keys: ["met", "methionine", "dl-methionine", "dl_met"],
      preferredIds: ["dl_met"],
      match: (id) => /^dl_met$/i.test(id)
    }
  ];

  for (const rule of familyRules) {
    if (!rule.keys.some((k) => rawLower.includes(k))) continue;

    for (const pref of rule.preferredIds || []) {
      if (db[pref] && typeof db[pref] === "object") {
        return {
          ingredient_id: pref,
          row: db[pref]
        };
      }
    }

    const fallbackFamilyId = Object.keys(db).find((id) => rule.match(id));
    if (fallbackFamilyId && db[fallbackFamilyId]) {
      return {
        ingredient_id: fallbackFamilyId,
        row: db[fallbackFamilyId]
      };
    }
  }

  let best = { id: null, row: null, score: -1 };

  for (const [id, row] of Object.entries(db || {})) {
    if (!row || typeof row !== "object") continue;

    const display = String(row.display_name || "").trim();
    const profile = toReviewNutrientProfile(row);

    let score = scoreTextSimilarity(raw, [id, display]);

    if (cpHint != null && profile.cp != null) {
      const diff = Math.abs(cpHint - profile.cp);
      if (diff <= 0.5) score += 35;
      else if (diff <= 1.0) score += 25;
      else if (diff <= 2.0) score += 15;
      else if (diff <= 4.0) score += 5;
    }

    if (score > best.score) {
      best = { id, row, score };
    }
  }

  if (best.id && best.row && best.score >= 60) {
    return {
      ingredient_id: best.id,
      row: best.row
    };
  }

  return {
    ingredient_id: null,
    row: null
  };
}
function extractPctFirstFromLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;
  if (raw.startsWith("=>")) return null;

  const compact = raw.replace(/\s+/g, " ").trim();

  const match = compact.match(/(\d{1,3}\.\d{1,4})/);
  if (!match) return null;

  const pct = parseFloat(match[1]);
  if (!Number.isFinite(pct)) return null;
  if (pct <= 0 || pct > 80) return null;

  let namePart = compact.slice(0, match.index).trim();

  // remove leading code numbers
  namePart = namePart.replace(/^\d+\s+/, "").trim();

  // strip trailing grades like 44%, 54%, 26-28%, 60%
  namePart = namePart.replace(/\b\d{1,3}(?:-\d{1,3})?\s*%$/i, "").trim();

  if (!namePart) return null;

  // reject nutrient/spec rows
  if (
    /^(dm|cp|me|ame|amen|ne|ee|fat|cf|ash|ca|av\.?\s*p|avp|na|k|cl|deb|nfe|lys|met|cyst|m\+c|thr|trp|arg|ile|leu|val|his)$/i.test(namePart)
  ) {
    return null;
  }

  // reject digestible-aa / spec side rows
  if (/\((d|dig|digestible)\)/i.test(namePart)) return null;

  // reject obvious non-ingredient business/report rows
  if (
    /^(remarks|date|factor|status|value|cost|cost\s*\/\s*bag|market rate|savings|foh|gst|pellet quality factor|press capacity factor|abrassiveness factor|ration nutrition limits|ration ingredients ratios|fact plant|broiler starter|poor|low|non-abbr|non abbr|nonabbr)$/i.test(namePart)
  ) {
    return null;
  }

  // reject known spec labels that can appear glued
  if (/^(deb|l-acid)$/i.test(namePart)) return null;

  if (!/[a-z]/i.test(namePart)) return null;
  if (namePart.length < 2) return null;

  return {
    name: namePart,
    pct
  };
}

function scanCandidatesPctFirst(text) {
  const t = degluePdfText(text);
  const lines = String(t || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const hits = [];
  const seen = new Set();

  for (const line of lines) {
    const got = extractPctFirstFromLine(line);
    if (!got) continue;

    const nm = got.name;
    const pct = got.pct;
    const key = `${lc(nm)}|${pct}`;

    if (seen.has(key)) continue;
    seen.add(key);

    hits.push({ name: nm, pct });
    console.log("[DBG HIT]", nm, pct);
  }

  hits.sort((a, b) => (b.pct || 0) - (a.pct || 0));
  if (hits.length < 17) {
    console.log("[DBG scanCandidates low count]", hits.length, "lines:", lines.length);
    lines.forEach((l, i) => { if (/valine|tryptophan|genphase/i.test(l)) console.log("[DBG missing line]", i, JSON.stringify(l)); });
  }
  return hits;
}

function softGateAndDedup(rawCandidates) {
  const map = new Map();

  let unresolved = 0;
  let resolved = 0;
  const unresolved_samples = [];

  for (const it of rawCandidates) {
    const inclusion = toNum(it.pct);
    if (inclusion == null) continue;
    if (inclusion < 0.001) continue;

    // FIX 0: reject obviously wrong inclusion values
    if (inclusion <= 0 || inclusion > 80) continue;

    const display = normalizeDisplayName(it.name);
    if (!display) continue;

    // FIX 1: reject nutrient/spec rows that are not real ingredient names
    if (
      /^(dm|cp|me|ame|amen|ne|ee|fat|cf|ash|ca|av\.?\s*p|avp|na|k|cl|deb|nfe|lys|met|cyst|m\+c|thr|trp|arg|ile|leu|val|his)$/i.test(display)
    ) {
      continue;
    }

    // FIX 2: ingredient names must look like real names
    if (/valine|tryptophan|genphase/i.test(display)) console.log("[DBG AA at gate]", display, "canonical:", tryResolveToCanonical(display));
    if (!/[a-z]/i.test(display)) continue;
    if (display.length < 3) continue;

    let canonical = tryResolveToCanonical(display);

// ==============================
// EARLY SBM GRADE PROMOTION FIX
// Must happen before DBG gate row and before finalSet/map is built
// ==============================
const displayLowForSbm = String(display || "").toLowerCase();
const rawLowForSbm = String(it?.name || "").toLowerCase();
const combinedForSbm = `${rawLowForSbm} ${displayLowForSbm}`.trim();

if (
  canonical === "soybean_meal" ||
  /^sbm\b/i.test(rawLowForSbm) ||
  /^sbm\b/i.test(displayLowForSbm) ||
  /soybean\s*meal/i.test(rawLowForSbm) ||
  /soybean\s*meal/i.test(displayLowForSbm)
) {
  if (
    /\b44(\.5)?\s*%?\b/.test(combinedForSbm) ||
    /^sbm\b/i.test(rawLowForSbm) ||
    /^sbm\b/i.test(displayLowForSbm)
  ) {
    canonical = "soybean_meal_44_5_cp";
  } else if (/\b46(\.5)?\s*%?\b/.test(combinedForSbm)) {
    canonical = "soybean_meal_46_5_cp";
  } else if (/\b48\s*%?\b/.test(combinedForSbm)) {
    canonical = "soybean_meal_48_cp";
  } else {
    canonical = "soybean_meal_44_5_cp";
  }
}



// APC grade detection — distinguish 55% vs 65% before dedup
const _apcRawLow = String(it?.name || '').toLowerCase();
const _apcDispLow = String(display || '').toLowerCase();
const _apcCombined = `${_apcRawLow} ${_apcDispLow}`.trim();
if (/\bapc\b/.test(_apcCombined)) {
  if (/65/.test(_apcCombined)) {
    canonical = 'animal_protein_concentrate_65_cp';
  } else if (/55/.test(_apcCombined)) {
    canonical = 'animal_protein_concentrate_55_cp';
  } else if (inclusion <= 2) {
    canonical = 'animal_protein_concentrate_65_cp';
  } else {
    canonical = 'animal_protein_concentrate_55_cp';
  }
}



// DEBUG: track critical ingredients through gate
if (
  /sbm|soybean meal|canola|sunflower|c\.?\s*g|corn gluten|cgm|millet|soyabean oil|soybean oil|fish meal|premix|phytase|protease|nsps|agps|toxin binder|anti coccidial|choline chloride|maize|rice broken|salt|dlm/i.test(display)
) {
  console.log("[DBG gate row]", {
    raw_name: it.name,
    display,
    pct: inclusion,
    canonical
  });
}

if (!canonical) {
  unresolved++;

  if (INGEST_DEBUG && unresolved_samples.length < 20) {
    unresolved_samples.push(display);
  }

  if (/valine|tryptophan|genphase/i.test(display)) {
    console.log("[DBG AA DROPPED no canonical]", display);
  }

  continue;
}

resolved++;
const prev = map.get(canonical);

if (!prev || inclusion > prev.inclusion) {
  map.set(canonical, {
    display,
    canonical,
    inclusion,
    source_name: String(it.name || "").trim(),
  });
}
  }

  console.log("[DBG gate map keys]", Array.from(map.keys()));
  const out = Array.from(map.values()).sort(
    (a, b) => (b.inclusion || 0) - (a.inclusion || 0)
  );

  if (INGEST_DEBUG) {
    console.log("[DBG gate]", {
      raw: rawCandidates.length,
      resolved,
      unresolved,
      out: out.length,
      unresolved_samples,
    });
  }

  return {
    out,
    resolved_count: resolved,
    unresolved_count: unresolved,
    unresolved_samples,
  };
}

function chooseSetClosestTo100(items) {
  if (!items.length) return { set: [], sum: 0 };

  const top = items.slice(0, 80);
  const MIN_ING = 8;

  let best = { diff: Infinity, set: [], sum: 0 };

  for (let start = 0; start < Math.min(25, top.length); start++) {
    let sum = 0;
    const set = [];

    for (let i = start; i < top.length; i++) {
      const it = top[i];
      if (sum + it.inclusion > 112) continue;
      set.push(it);
      sum += it.inclusion;
      // never break early — collect all ingredients
    }

    if (set.length < MIN_ING) continue;

    const diff = Math.abs(sum - 100);
    if (diff < best.diff) best = { diff, set, sum };
    if (diff < 0.1) break;
  }

  if (!best.set.length) {
    const fallback = top.slice(0, 25);
    const sum = fallback.reduce((a, b) => a + b.inclusion, 0);
    return { set: fallback, sum };
  }

  return best;
}

function maybeAutoNormalize(set, sum) {
  if (!set.length) return { set, sum, normalized: false, factor: 1 };
  if (sum > 105 || sum < 95) {
    const factor = 100 / sum;
    const scaled = set.map((it) => ({ ...it, inclusion: it.inclusion * factor }));
    return { set: scaled, sum: 100, normalized: true, factor };
  }
  return { set, sum, normalized: false, factor: 1 };
}

function pickBestRegionText(rawText) {
  const t = degluePdfText(rawText);
  const lines = String(t || "")
    .split(/\r?\n/)
    .map(x => String(x || "").trim());

  if (lines.length < 10) return { text: t, start: 0, score: -1 };

  const WINDOW = 80;
  const STEP = 20;
  let best = { score: -Infinity, text: t, start: 0 };

  const specRowRegex =
    /^(dm|cp|me|ame|amen|ne|ee|fat|cf|ash|ca|av\.?\s*p|avp|na|k|cl|deb|nfe|lys|met|cyst|m\+c|thr|trp|arg|ile|leu|val|his)\b/i;

  const noteRowRegex =
    /^(poor|low|non-abbr|factor|status|value|remarks|date|market rate|savings|foh|gst|cost\b|press capacity|pellet quality|ration nutritionlimits|ration ingredientsratios)\b/i;

  function lineLooksLikeIngredientCandidate(line) {
    const got = extractPctFirstFromLine(line);
    if (!got) return false;

    const name = String(got.name || "").trim();
    const pct = Number(got.pct || 0);

    if (!name) return false;
    if (!Number.isFinite(pct) || pct <= 0 || pct > 60) return false;
    if (specRowRegex.test(name)) return false;
    if (noteRowRegex.test(name)) return false;
    if (/\((d|dig|digestible)\)/i.test(name)) return false;

    return true;
  }

  for (let start = 0; start < lines.length; start += STEP) {
    const regionLines = lines.slice(start, start + WINDOW);
    const chunk = regionLines.join("\n");

    const rawCandidates = scanCandidatesPctFirst(chunk);
    const gated = softGateAndDedup(rawCandidates);

    // use full gated set for region scoring; do not drop micro ingredients here
    const fullSet = Array.isArray(gated.out) ? [...gated.out] : [];
    const sum = fullSet.reduce((s, x) => s + Number(x?.inclusion || 0), 0);

    let candidateLikeLines = 0;
    let specLikeLines = 0;
    let largeCount = 0;

    for (const line of regionLines) {
      const trimmed = String(line || "").trim();
      if (!trimmed) continue;

      if (lineLooksLikeIngredientCandidate(trimmed)) {
        candidateLikeLines++;
        continue;
      }

      const got = extractPctFirstFromLine(trimmed);
      if (got) {
        const name = String(got.name || "").trim();
        const pct = Number(got.pct || 0);

        if (
          specRowRegex.test(name) ||
          /\((d|dig|digestible)\)/i.test(name) ||
          noteRowRegex.test(name)
        ) {
          specLikeLines++;
        }

        if (Number.isFinite(pct) && pct >= 2) {
          largeCount++;
        }
      }
    }

    const diff = Math.abs(sum - 100);

    const score =
      candidateLikeLines * 120 +
      gated.resolved_count * 25 +
      largeCount * 20 -
      specLikeLines * 80 -
      diff * 12;

    if (score > best.score) {
      best = { score, text: chunk, start };
    }
  }

  // For FACT-format PDFs (contain "Total 100.0 NNNN"), always use full text
  // Windowing breaks FACT format by splitting ingredient rows from the total line
  if (/total\s+100\.?0*\s+\d+/i.test(t)) {
    return { score: best.score, start: 0, text: t };
  }

  // merge best window with immediate neighbors so trailing additives are not lost
  const mergedStart = Math.max(0, best.start - STEP);
  const mergedEnd = Math.min(lines.length, best.start + WINDOW + STEP);

  return {
    score: best.score,
    start: mergedStart,
    text: lines.slice(mergedStart, mergedEnd).join("\n")
  };
}

function scoreSet(set, sum) {
  const diff = Math.abs(sum - 100);
  const n = set.length;
  const lenPenalty = 0; // removed: was penalizing large formulas

  const microKeys =
    /^(phytase|protease|nsps?|toxin_binder|anti_coccidial|choline_chloride|dlm|dl_met|l_lys_hcl|salt)$/i;

  let microMax = 0;
  for (const it of set) {
    if (microKeys.test(it.canonical)) {
      microMax = Math.max(microMax, it.inclusion);
    }
  }

  if (microMax > 5.0) {
    return {
      ok: false,
      score: -9999,
      reason: `micro_too_high(${microMax.toFixed(3)})`,
    };
  }

  const score = 10000 - diff * 250 - lenPenalty;
  return { ok: true, score, reason: "ok" };
}

function extractFormulaFromPdfText(rawText) {
  // ═══════════════════════════════════════════════════════════════════════
  // GLOBAL MULTI-FORMAT PDF PARSER v14
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Supports all real-world feed formula PDF formats:
  //   MODE 1 — FACT / SF Poultry / any feed-mill tool with batch weight
  //             Token-stream: [code][Name IR%][Weight] per row
  //             Validated by: Weight = IR% × batchFactor ±30%
  //   MODE 2 — PHN / Bestmix / WinFeed
  //             [code][Name][-O price][Amount][Pct] per row
  //   MODE 3 — Orangeburg / "Ingredients and Amounts" table
  //             [code][Name][Pct][Amount] under section header
  //   MODE 4 — Numbered list: "1. Maize 55.0"
  //   MODE 5 — Simple pairs: "Name value" any language, European decimals
  //   MODE 6 — Column-packed: split on 2+ spaces
  //   MODE 7 — Fallback: original scanCandidatesPctFirst engine
  //
  // Key design decisions:
  //   - degluePdfText runs FIRST to split glued tokens
  //   - No windowing, no scoring = zero latency overhead
  //   - Nutrient rejection: (D) suffix OR pure abbreviation ONLY
  //     so L-Isoleucine, L-Valine, Iso-Leucine are NEVER rejected
  //   - Unknown ingredients kept at their inclusion % (not dropped)
  //   - Returns identical structure to original for zero downstream changes
  // ═══════════════════════════════════════════════════════════════════════

  // ── Helpers ─────────────────────────────────────────────────────────────
  const _BAD = new Set([
    "poor","low","non-abbr","values","min","max","target","actual","total",
    "name","codes","weight","factor","status","value","remarks","date","plant",
    "formula","pellet quality factor","press capacity factor","abrassiveness factor",
    "ingredient","ir","ir %","ingredients","nutrition","ration ingredients",
    "ration nutrition","warning","no.","page","user","pricing plant",
    "stored formula report","ingredient report","ingredients and amounts",
    "% as fed","amount","pct","cost","minimum","maximum","dry matter",
    "species","batch","description","code","price","sf poultry","broiler",
    "factor status value","ration nutrition","ration ingredients"
  ]);

  function _ck(s){return String(s||"").toLowerCase().replace(/\s+/g," ").trim();}
  function _san(s){return String(s||"").trim().replace(/([a-z])([A-Z])/g,"$1 $2").replace(/\s{2,}/g," ").trim();}
  function _n(s){
    const c=String(s||"").trim();
    const n=Number(c.includes(",")&&!c.includes(".")?c.replace(",","."):c.replace(/,/g,""));
    return Number.isFinite(n)?n:NaN;
  }
  function _bad(name){
    if(!name||name.length<2)return true;
    if(/^\d+$/.test(name)||/^\W+$/.test(name))return true;
    if(/^(sf\s|broiler\s|layer\s|starter\s|grower\s|finisher\s)/i.test(name))return true;
    return _BAD.has(_ck(name));
  }
  function _okp(p){return Number.isFinite(p)&&p>0&&p<=100;}

  // Nutrient detection: ONLY reject (D) suffix or pure abbreviations
  // NEVER reject L-prefixed or Iso-prefixed ingredient names
  function _isNutrient(name){
    if(/\(\s*[Dd]\s*\)/.test(name))return true; // "Lysine (D)", "Valine (D)"
    if(/^(me|cp|ee|cf|ca|na|k|cl|deb|starch|ndf|adf|ash|dm|tdn|nfe|avp)$/i.test(name))return true;
    if(/^ph\s*\(/i.test(name))return true;
    if(/^m\+c/i.test(name))return true;
    if(/^(lys|met|thr|trp|arg|ile|leu|val|his|phe|gly|ser|pro|ala|cys|tyr)$/i.test(name))return true;
    return false;
  }

  function _dedup(rows){
    const s=new Set();
    return rows.filter(r=>{const k=_ck(r.ing)+"|"+r.pct;if(s.has(k))return false;s.add(k);return true;});
  }

  function _resolve(name){
    try{
      const ra=getResolveAlias();
      const r=ra(cleanName(name));
      if(r&&r.canonical_key)return r.canonical_key;
    }catch(e){}
    return FALLBACK_CANONICAL[cleanName(name)]||null;
  }

  function _buildReturn(rows, mode){
    const resolvedRows=rows.map(r=>{
      const canonical=_resolve(r.ing)||r.ing;
      return{
        ingredient_name:r.ing, raw_name:r.ing,
        ingredient_id:canonical, canonical_id:canonical, ingredient_code:canonical,
        inclusion:Number(r.pct), resolved:!!_resolve(r.ing), confidence:_resolve(r.ing)?1:0.5,
        is_unknown:!_resolve(r.ing),
      };
    });
    const formulaText=resolvedRows
      .map(r=>`${r.ingredient_id} ${Number(r.inclusion).toFixed(4).replace(/\.?0+$/,"")}`)
      .join("\n");
    const total=rows.reduce((s,r)=>s+r.pct,0);
    console.log(`[DBG multiformat v14] mode=${mode} rows=${rows.length} total=${total.toFixed(2)}`);
    return{
      formula_text:formulaText, resolved_rows:resolvedRows,
      formula_lines_count:resolvedRows.length, picked_total:total,
      candidates:rows.length, method:`multiformat_v14_${mode}`,
      normalized:Math.abs(total-100)<1, normalize_factor:1,
      chosen_column:"MULTIFORMAT", score_reason:"ok",
      gated_count:resolvedRows.length,
      resolved_count:resolvedRows.filter(r=>r.resolved).length,
      unresolved_count:resolvedRows.filter(r=>!r.resolved).length,
      formula_head:formulaText.split("\n").slice(0,20).join("\n"),
      debug:undefined,
    };
  }

  // Apply degluePdfText to split glued tokens like "Maize/Corn22.22" -> "Maize/Corn 22.22"
  const deglued = degluePdfText(rawText);
  const rawLines = String(deglued||"").replace(/\r/g,"\n").split("\n")
    .map(l=>l.replace(/\t/g," ").replace(/\s{2,}/g," ").trim())
    .filter(l=>l&&l.length<300);

  let _result = null;

  // ── MODE 1: FACT / feed-mill token-stream ───────────────────────────────
  // Structure after degluePdfText:
  //   line N:   "2"                    (row code - lone integer)
  //   line N+1: "Maize/Corn 22.22"     (name + IR% on same line after deglue)
  //   line N+2: "666.6"                (weight_kg)
  //   line N+3: "5"                    (nutrition code)
  //   line N+4: "ME"                   (nutrient name)
  //   line N+5: "3,000.00"             (nutrient value)
  // Validated: Weight ≈ IR% × batchFactor
  factParse: {
    // Detect batch size from split "Total / 100.0 / 3000" lines
    let bf=null;
    for(let _i=0;_i<rawLines.length-2;_i++){
      if(/^total$/i.test(rawLines[_i])){
        const _pct=parseFloat(rawLines[_i+1]);
        const _batch=parseFloat(rawLines[_i+2].replace(/,/g,""));
        if(Math.abs(_pct-100)<1&&_batch>100){bf=_batch/100;break;}
      }
      // Also handle single-line "Total 100.0 3000"
      const _tm=rawLines[_i].match(/^total\s+100(?:\.0+)?\s+(\d[\d,]*)/i);
      if(_tm){bf=_n(_tm[1])/100;break;}
    }
    if(!bf)break factParse;

    const rows=[];
    // Pattern: "Name decimal" line followed by weight line
    for(let _i=0;_i<rawLines.length-1;_i++){
      const _l=rawLines[_i];
      // Match: name followed by IR% value on same line
      const _m=_l.match(/^([A-Za-z][A-Za-z0-9\s\-\/\+\.\(\)%&,\']{1,60}?)\s+(\d{1,3}\.\d{1,6})\s*$/);
      if(!_m)continue;
      const name=_san(_m[1]);
      const ir=_n(_m[2]);
      if(_bad(name)||!_okp(ir))continue;
      if(_isNutrient(name))continue;
      // Validate weight on next line
      const _wt=_n(rawLines[_i+1]);
      if(!Number.isFinite(_wt)||_wt<=0)continue;
      const ratio=_wt/(ir*bf);
      if(ratio<0.65||ratio>1.45)continue;
      rows.push({ing:name,pct:ir});
    }
    if(rows.length>=3)_result=_buildReturn(_dedup(rows),"fact_format");
  }

  // ── MODE 2: PHN / Bestmix / WinFeed ────────────────────────────────────
  if(!_result) {
    const RE=/^(\d{1,4}(?:-\d+)?)\s+([A-Za-z][A-Za-z0-9\s\-\/\+\.\(\)%&,\']{0,70}?)\s+(?:-[A-Z]\s+|\d[\d,.]*\s+)?(\d{1,6}(?:[.,]\d{1,4})?)\s+(\d{1,3}(?:[.,]\d{1,4})?)\s*$/;
    const rows=[];
    for(const l of rawLines){
      if(/^(total|code\s+ingred|warning|no\.|formula|batch|stored|pricing|page|user|plant|species)\b/i.test(l))continue;
      const m=l.match(RE);if(!m)continue;
      const name=_san(m[2].replace(/\s+-[A-Z]\s*$/,"").trim()),pct=_n(m[4].replace(",","."));
      if(_bad(name)||!_okp(pct))continue;
      rows.push({ing:name,pct});
    }
    if(rows.length>=3)_result=_buildReturn(_dedup(rows),"phn_format");
  }

  // ── MODE 3: Orangeburg / "Ingredients and Amounts" ──────────────────────
  if(!_result){
    const rows=[];let inSec=false;
    for(const l of rawLines){
      if(/ingredients.*amounts/i.test(l)){inSec=true;continue;}
      if(/^total\b/i.test(l)){if(inSec)break;continue;}
      if(!inSec||/^(ingredients|%\s*as\s*fed|amount|no\.)/i.test(l))continue;
      const m=l.match(/^(\d{1,4}(?:-\d+)?)\s+([A-Za-z][A-Za-z0-9\s\-\/\+\.\(\)%&,\']{0,60}?)\s+(\d{1,3}(?:\.\d{1,6})?)\s+(\d{1,6}(?:\.\d{1,4})?)\s*$/);
      if(!m)continue;
      const name=_san(m[2]),pct=_n(m[3]);
      if(_bad(name)||!_okp(pct))continue;
      rows.push({ing:name,pct});
    }
    if(rows.length>=2)_result=_buildReturn(_dedup(rows),"orangeburg_format");
  }

  // ── MODE 4: Numbered list ────────────────────────────────────────────────
  if(!_result){
    const rows=[];
    for(const l of rawLines){
      const m=l.match(/^\d{1,3}[.)]\s+([A-Za-zÀ-ÿ][A-Za-z0-9À-ÿ\s\-\/\+\.\(\)%&,\']{1,60}?)\s+(\d{1,3}(?:[.,]\d{1,6})?)\s*%?\s*$/);
      if(!m)continue;
      const name=_san(m[1]),pct=_n(m[2]);
      if(_bad(name)||!_okp(pct)||_isNutrient(name))continue;
      rows.push({ing:name,pct});
    }
    if(rows.length>=3)_result=_buildReturn(_dedup(rows),"numbered_list");
  }

  // ── MODE 5: Simple pairs (Unicode-safe, European decimals) ───────────────
  if(!_result){
    const rows=[];
    const RE=/^([A-Za-zÀ-ÖØ-öø-ÿ\u0600-\u06FF\u4E00-\u9FFF][A-Za-z0-9À-ÿ\u0600-\u06FF\u4E00-\u9FFF\s\-\/\+\.\(\)%&,\']{1,60}?)[\s:=\t]+(-?\d{1,3}(?:[.,]\d{1,6})?)\s*%?\s*$/;
    for(const l of rawLines){
      if(/^(total|codes|factor|warning|page|user)\b/i.test(l))continue;
      const m=l.match(RE);if(!m)continue;
      const name=_san(m[1]),pct=_n(m[2]);
      if(_bad(name)||!_okp(pct)||_isNutrient(name))continue;
      rows.push({ing:name,pct});
    }
    if(rows.length>=2)_result=_buildReturn(_dedup(rows),"simple_pairs");
  }

  // ── MODE 6: Column-packed (2+ space split) ───────────────────────────────
  if(!_result){
    const rows=[];
    for(const l of rawLines){
      if(/^(total|codes|factor|plant|formula|remarks|date|warning|page)\b/i.test(l))continue;
      const segs=l.split(/\s{2,}/);if(segs.length<2)continue;
      for(let _i=0;_i+1<segs.length;_i++){
        const m=(segs[_i].trim()+" "+segs[_i+1].trim()).match(/^([A-Za-zÀ-ÿ][A-Za-z0-9\s\-\/\+\.\(\)%&\']{1,60}?)\s+(\d{1,3}(?:[.,]\d{1,6})?)\s*%?$/);
        if(!m)continue;
        const name=_san(m[1]),pct=_n(m[2]);
        if(_bad(name)||!_okp(pct)||_isNutrient(name))continue;
        rows.push({ing:name,pct});
      }
    }
    if(rows.length>=2)_result=_buildReturn(_dedup(rows),"column_packed");
  }

  if(_result)return _result;

  // ── MODE 7: Fallback to original scanCandidatesPctFirst engine ───────────
  console.log("[DBG multiformat v14] all modes failed, falling back to legacy engine");
  const pick=pickBestRegionText(rawText);
  const rawCandidates=scanCandidatesPctFirst(pick.text);
  const gated=softGateAndDedup(rawCandidates);
  const chosen={set:Array.isArray(gated.out)?[...gated.out]:[]};
  const mergedSum=chosen.set.reduce((s,x)=>s+Number(x?.inclusion||0),0);
  const normed=maybeAutoNormalize(chosen.set,mergedSum);
  const factor=Number(normed?.factor||1);
  let finalSet=normed.set, finalSum=normed.sum;
  if(factor>1.60||factor<0.60){finalSet=chosen.set;finalSum=mergedSum;}
  const score=scoreSet(finalSet,finalSum);
  const finalFormulaText=finalSet.map((it)=>{
    const outName=String(it.canonical||it.display||"").trim();
    return `${outName} ${Number(it.inclusion).toFixed(4).replace(/\.?0+$/,"")}`;
  }).join("\n");
  const finalResolvedRows=finalSet.map((it)=>({
    ingredient_name:it.display, raw_name:it.source_name||it.display,
    ingredient_id:it.canonical, canonical_id:it.canonical, ingredient_code:it.canonical,
    inclusion:Number(it.inclusion), resolved:true, confidence:1,
  }));
  return{
    formula_text:finalFormulaText, resolved_rows:finalResolvedRows,
    formula_lines_count:finalSet.length, picked_total:finalSum,
    candidates:rawCandidates.length, method:"pctfirst_blockpick_autonormalize_v29",
    normalized:Math.abs((finalSum||0)-100)<1, normalize_factor:Number(normed?.factor||1),
    chosen_column:"PCT_FIRST", score_reason:score.reason,
    gated_count:gated.out.length, resolved_count:gated.resolved_count,
    unresolved_count:gated.unresolved_count,
    formula_head:finalFormulaText.split("\n").slice(0,20).join("\n"),
    debug:undefined,
  };
}

// ===== SAFE FALLBACK PARSER (DO NOT REMOVE EXISTING LOGIC) =====

function extractSimpleFormulaRowsFromPdfText(rawText) {
  const text = degluePdfText(rawText);
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((x) => norm(x))
    .filter(Boolean);

  const out = [];
  const seen = new Set();

  for (const line of lines) {
    if (!line) continue;
    if (looksJunky(line)) continue;

    const m = line.match(/^(.+?)\s+(-?\d+(?:\.\d+)?)$/);
    if (!m) continue;

    const display = normalizeDisplayName(m[1]);
    const inclusion = toNum(m[2]);

    if (!display || inclusion == null) continue;
    if (inclusion <= 0 || inclusion > 100) continue;

    const canonical = tryResolveToCanonical(display);
    if (!canonical) continue;

    const key = `${canonical}|${Number(inclusion.toFixed(4))}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      display,
      canonical,
      inclusion,
    });
  }

  out.sort((a, b) => (b.inclusion || 0) - (a.inclusion || 0));
  return out;
}

function buildFormulaTextFromItems(items = []) {
  return items
    .map((it) => `${it.display} ${Number((it.inclusion || 0).toFixed(4))}`)
    .join("\n");
}

function isSuspiciousPdfFormulaExtraction(f) {
  const head = String(f?.formula_head || "").trim().toLowerCase();
  const lines = Number(f?.formula_lines_count || 0);
  const pickedTotal = Number(f?.picked_total || 0);

  if (!lines || lines <= 1) return true;
  if (!head) return true;
  if (head === "salt 100") return true;
  if (/^salt\s+100/i.test(head)) return true;
  if (pickedTotal > 0 && pickedTotal < 5) return true;

  return false;
}

function fallbackExtractFormulaFromPdfText(rawText) {
  const items = extractSimpleFormulaRowsFromPdfText(rawText);
  const sum = items.reduce((a, b) => a + (Number(b.inclusion) || 0), 0);

  return {
    formula_text: buildFormulaTextFromItems(items),
    formula_lines_count: items.length,
    picked_total: Number(sum.toFixed(4)),
    candidates: items.length,
    method: "pdf_line_fallback_v1",
    normalized: false,
    normalize_factor: 1,
    chosen_column: "LINE_ENDING_VALUE",
    score_reason: "fallback_line_parser_used",
    gated_count: items.length,
    resolved_count: items.length,
    unresolved_count: 0,
    formula_head: buildFormulaTextFromItems(items).slice(0, 260),
  };
}

function cleanObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v != null && v !== "") out[k] = v;
  }
  return out;
}

function normalizeQcNutrients(nutrients = {}) {
  const out = {};

  const keys = [
    "moisture",
    "dm",
    "cp",
    "ee",
    "cf",
    "ash",
    "starch",
    "sugars",
    "me",
    "me_kcal",
    "me_mj",
    "ca",
    "total_p",
    "avp",
    "na",
    "k",
    "cl",
    "mg",
    "s",
    "deb",
    "total_lys",
    "total_met",
    "total_metcys",
    "total_thr",
    "total_trp",
    "total_arg",
    "total_val",
    "total_ile",
    "total_leu",
    "sid_lys",
    "sid_met",
    "sid_metcys",
    "sid_thr",
    "sid_trp",
    "sid_arg",
    "sid_val",
    "sid_ile",
    "sid_leu",
  ];

  const explicitZeroAllowed = new Set([
    "moisture",
    "dm",
    "cp",
    "ee",
    "cf",
    "ash",
    "starch",
    "sugars",
    "me",
    "me_kcal",
    "me_mj",
    "ca",
    "total_p",
    "avp",
    "na",
    "k",
    "cl",
    "mg",
    "s",
    "deb"
  ]);

  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(nutrients, k)) continue;
    const raw = nutrients[k];
    if (raw === "" || raw == null) continue;

    const v = toNum(raw);
    if (v == null) continue;

    if (v === 0 && !explicitZeroAllowed.has(k)) continue;
    out[k] = v;
  }

  if (out.moisture != null && out.dm == null) {
    out.dm = Number((100 - out.moisture).toFixed(4));
  } else if (out.dm != null && out.moisture == null) {
    out.moisture = Number((100 - out.dm).toFixed(4));
  }

  if (out.me == null && out.me_kcal != null) out.me = out.me_kcal;
  if (out.me_kcal == null && out.me != null) out.me_kcal = out.me;
  if (out.me_mj == null && out.me_kcal != null) {
    out.me_mj = Number((out.me_kcal / 239.005736).toFixed(4));
  }

  return out;
}

function normalizeQcNutrientKey(rawKey) {
  const k = cleanName(rawKey);

  const map = {
    moisture: "moisture",
    water: "moisture",
    dm: "dm",
    "dry matter": "dm",
    cp: "cp",
    "crude protein": "cp",
    ee: "ee",
    "ether extract": "ee",
    fat: "ee",
    cf: "cf",
    "crude fiber": "cf",
    fibre: "cf",
    "crude fibre": "cf",
    ash: "ash",
    starch: "starch",
    sugar: "sugars",
    sugars: "sugars",
    me: "me",
    "me kcal": "me_kcal",
    "me kcal kg": "me_kcal",
    "me kcal/kg": "me_kcal",
    "me mj": "me_mj",
    "me mj kg": "me_mj",
    "me mj/kg": "me_mj",
    ca: "ca",
    calcium: "ca",
    p: "total_p",
    "total p": "total_p",
    phosphorus: "total_p",
    avp: "avp",
    "available p": "avp",
    na: "na",
    sodium: "na",
    k: "k",
    potassium: "k",
    cl: "cl",
    chloride: "cl",
    mg: "mg",
    magnesium: "mg",
    s: "s",
    sulfur: "s",
    sulphur: "s",
    deb: "deb",
    "total lys": "total_lys",
    lys: "total_lys",
    "total methionine": "total_met",
    "total met": "total_met",
    met: "total_met",
    "total met cys": "total_metcys",
    "total met+cys": "total_metcys",
    "met cys": "total_metcys",
    "met+cys": "total_metcys",
    "total thr": "total_thr",
    thr: "total_thr",
    "total trp": "total_trp",
    trp: "total_trp",
    "total arg": "total_arg",
    arg: "total_arg",
    "total val": "total_val",
    val: "total_val",
    "total ile": "total_ile",
    ile: "total_ile",
    "total leu": "total_leu",
    leu: "total_leu",
    "sid lys": "sid_lys",
    "dig lys": "sid_lys",
    "sid met": "sid_met",
    "dig met": "sid_met",
    "sid met cys": "sid_metcys",
    "sid met+cys": "sid_metcys",
    "dig met cys": "sid_metcys",
    "dig met+cys": "sid_metcys",
    "sid thr": "sid_thr",
    "dig thr": "sid_thr",
    "sid trp": "sid_trp",
    "dig trp": "sid_trp",
    "sid arg": "sid_arg",
    "dig arg": "sid_arg",
    "sid val": "sid_val",
    "dig val": "sid_val",
    "sid ile": "sid_ile",
    "dig ile": "sid_ile",
    "sid leu": "sid_leu",
    "dig leu": "sid_leu",
  };

  return map[k] || null;
}

function extractQcNutrientsFromXlsxRows(rows = []) {
  const out = {};

  for (const row of rows) {
    if (!row || row.length < 2) continue;
    const rawKey = String(row[0] ?? "").trim();
    const rawVal = row[1];
    const nk = normalizeQcNutrientKey(rawKey);
    const v = toNum(rawVal);
    if (nk && v != null) out[nk] = v;
  }

  if (rows.length >= 2 && Array.isArray(rows[0]) && Array.isArray(rows[1])) {
    const headerRow = rows[0];
    const valueRow = rows[1];

    for (let i = 0; i < Math.min(headerRow.length, valueRow.length); i++) {
      const nk = normalizeQcNutrientKey(headerRow[i]);
      const v = toNum(valueRow[i]);
      if (nk && v != null && out[nk] == null) out[nk] = v;
    }
  }

  return normalizeQcNutrients(out);
}

function buildQcRecord({
  sample_id,
  entered_name,
  matched_ingredient_id,
  matched_display_name,
  source,
  submitted_by,
  baseline_nutrients = {},
  nutrients,
  intake_type,
  source_system = null,
  filename = null,
  content_type = null,
  parse_meta = {},
}) {
  return cleanObject({
    sample_id,
    ingredient_id: matched_ingredient_id || null,
    ingredient_name:
      matched_display_name || entered_name || matched_ingredient_id || "",
    entered_name: entered_name || matched_display_name || matched_ingredient_id || "",
    matched_ingredient_id: matched_ingredient_id || null,
    matched_display_name:
      matched_display_name || entered_name || matched_ingredient_id || "",
    source,
    submitted_by,
    status: "pending_review",
    screening_status: "normal",
    decision_status: "pending",
    screening_score: 0,
    screening_reasons: [],
    trend_signals: [],
    nutrients: normalizeQcNutrients(nutrients || {}),
    reported_nutrients: normalizeQcNutrients(nutrients || {}),
    baseline_nutrients: normalizeQcNutrients(baseline_nutrients || {}),
    review_note: "",
    override_payload: null,
    meta: cleanObject({
      route_version: INGEST_ROUTE_VERSION,
      intake_type,
      canonical_resolved: !!matched_ingredient_id,
      source_system,
      filename,
      content_type,
      ...parse_meta,
    }),
  });
}

function getQcSamplesFile() {
  return require("path").resolve(__dirname, "../../data/qc/qc.samples.json");
}

function getQcAuditFile() {
  return require("path").resolve(__dirname, "../../data/qc/qc.audit.json");
}

function ensureParentDir(filePath) {
  const dir = require("path").dirname(filePath);
  require("fs").mkdirSync(dir, { recursive: true });
}

function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

function readJsonFileSafe(filePath, fallbackValue) {
  try {
    if (!require("fs").existsSync(filePath)) return fallbackValue;
    const raw = require("fs").readFileSync(filePath, "utf8");
    const cleaned = stripBom(raw);
    if (!cleaned || !cleaned.trim()) return fallbackValue;
    return JSON.parse(cleaned);
  } catch (_e) {
    return fallbackValue;
  }
}

function writeJsonFilePretty(filePath, value) {
  ensureParentDir(filePath);
  require("fs").writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function saveQcRecord(qc_record) {
  const sampleFile = getQcSamplesFile();
  const store = readJsonFileSafe(sampleFile, { samples: [] });

  if (!Array.isArray(store.samples)) {
    store.samples = [];
  }

  const sample_id = String(qc_record?.sample_id || "").trim();
  const idx = store.samples.findIndex(
    (x) => String(x?.sample_id || "").trim() === sample_id
  );

  if (idx >= 0) {
    store.samples[idx] = {
      ...store.samples[idx],
      ...qc_record,
      updated_at: new Date().toISOString(),
    };
  } else {
    store.samples.push({
      ...qc_record,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  writeJsonFilePretty(sampleFile, store);
  return { sampleFile, store };
}

function getIngredientMasterCandidateFiles() {
  return [
    require("path").resolve(
      __dirname,
      "../../../core/db/ingredients/poultry/us/v1/ingredients.poultry.us.sid.v1.json"
    ),
    require("path").resolve(
      __dirname,
      "../../../core/db/ingredients/poultry/br/v1/ingredients.poultry.br.sid.v1.json"
    ),
  ];
}

function loadIngredientMasterDb() {
  const candidateFiles = getIngredientMasterCandidateFiles();

  for (const file of candidateFiles) {
    try {
      if (!require("fs").existsSync(file)) continue;
      const raw = stripBom(require("fs").readFileSync(file, "utf8"));
      const json = JSON.parse(raw);

      if (json && json.db && typeof json.db === "object") return json.db;
      if (json && json.ingredients && typeof json.ingredients === "object") {
        return json.ingredients;
      }
      if (json && typeof json === "object") return json;
    } catch (_e) {}
  }

  return {};
}

function toReviewNutrientProfile(row = {}) {
  const p =
    row.nutrient_profile && typeof row.nutrient_profile === "object"
      ? row.nutrient_profile
      : row;

  const out = {};
  const keys = [
    "moisture",
    "dm",
    "cp",
    "ee",
    "cf",
    "ash",
    "starch",
    "sugars",
    "me",
    "me_kcal",
    "me_mj",
    "ca",
    "total_p",
    "avp",
    "na",
    "k",
    "cl",
    "mg",
    "s",
    "deb",
    "total_lys",
    "total_met",
    "total_metcys",
    "total_thr",
    "total_trp",
    "total_arg",
    "total_val",
    "total_ile",
    "total_leu",
    "sid_lys",
    "sid_met",
    "sid_metcys",
    "sid_thr",
    "sid_trp",
    "sid_arg",
    "sid_val",
    "sid_ile",
    "sid_leu",
  ];

  for (const k of keys) {
    const v = toNum(p[k]);
    if (v != null) out[k] = v;
  }

  if (out.me == null && out.me_kcal != null) out.me = out.me_kcal;
  if (out.me_kcal == null && out.me != null) out.me_kcal = out.me;
  if (out.me_mj == null && out.me_kcal != null) {
    out.me_mj = Number((out.me_kcal / 239.005736).toFixed(4));
  }

  if (out.moisture == null && out.dm != null) {
    out.moisture = Number((100 - out.dm).toFixed(4));
  }
  if (out.dm == null && out.moisture != null) {
    out.dm = Number((100 - out.moisture).toFixed(4));
  }

  return out;
}

function updateIngredientMasterRecord(ingredient_id, approved_profile) {
  const candidateFiles = getIngredientMasterCandidateFiles();

  for (const file of candidateFiles) {
    try {
      if (!require("fs").existsSync(file)) continue;

      const raw = stripBom(require("fs").readFileSync(file, "utf8"));
      const json = JSON.parse(raw);

      let container = null;
      if (json && json.db && typeof json.db === "object") container = json.db;
      else if (json && json.ingredients && typeof json.ingredients === "object") {
        container = json.ingredients;
      } else if (json && typeof json === "object") {
        container = json;
      }

      if (!container || !container[ingredient_id] || typeof container[ingredient_id] !== "object") {
        continue;
      }

      const row = container[ingredient_id];
      const baselineProfile = toReviewNutrientProfile(row);
      const before = JSON.parse(JSON.stringify(baselineProfile));

      if (!row.nutrient_profile || typeof row.nutrient_profile !== "object") {
        row.nutrient_profile = { ...baselineProfile };
      } else {
        row.nutrient_profile = {
          ...baselineProfile,
          ...row.nutrient_profile,
        };
      }

      for (const [k, v] of Object.entries(approved_profile || {})) {
        const n = toNum(v);
        if (n != null) row.nutrient_profile[k] = n;
      }

      if (row.nutrient_profile.me == null && row.nutrient_profile.me_kcal != null) {
        row.nutrient_profile.me = row.nutrient_profile.me_kcal;
      }
      if (row.nutrient_profile.me_kcal == null && row.nutrient_profile.me != null) {
        row.nutrient_profile.me_kcal = row.nutrient_profile.me;
      }
      if (row.nutrient_profile.me_mj == null && row.nutrient_profile.me_kcal != null) {
        row.nutrient_profile.me_mj = Number((row.nutrient_profile.me_kcal / 239.005736).toFixed(4));
      }

      if (row.nutrient_profile.dm != null) {
        row.nutrient_profile.moisture = Number((100 - row.nutrient_profile.dm).toFixed(4));
      } else if (row.nutrient_profile.moisture != null) {
        row.nutrient_profile.dm = Number((100 - row.nutrient_profile.moisture).toFixed(4));
      }

      const after = JSON.parse(JSON.stringify(row.nutrient_profile));
      require("fs").writeFileSync(file, JSON.stringify(json, null, 2), "utf8");

      return {
        ok: true,
        file,
        before,
        after,
      };
    } catch (e) {
      return {
        ok: false,
        file,
        error: e?.message || String(e),
      };
    }
  }

  return {
    ok: false,
    error: "INGREDIENT_NOT_FOUND_IN_MASTER_DB",
  };
}

router.post("/v1/ingest", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        ok: false,
        message: "No file uploaded (field name must be 'file').",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const filename = file.originalname || "upload";
    const mime = file.mimetype || "application/octet-stream";
    const size_bytes = file.size || 0;
    const requested_kind = String(req.body?.kind || "").trim().toLowerCase();

    let detected = null;
    try {
      detected = await fileTypeFromBuffer(file.buffer);
    } catch {
      detected = null;
    }

    const detected_mime = detected?.mime || mime;
    const detected_ext = detected?.ext || "";

    console.log("[INGEST_AUDIT] received", {
      filename,
      size_bytes,
      mime,
      detected_mime,
      detected_ext,
      requested_kind,
      max_upload_mb: MAX_UPLOAD_MB,
      route_version: INGEST_ROUTE_VERSION,
    });

    const toSafeNumber = (v) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const cleanKey = (v) =>
      String(v || "")
        .trim()
        .toLowerCase()
        .replace(/[%()]/g, "")
        .replace(/[+\-]/g, "_")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    const buildFormulaTextFromIngredientRows = (rows) => {
      if (!Array.isArray(rows) || !rows.length) return "";
      return rows
        .filter((r) => r && r.ingredient_name && toSafeNumber(r.inclusion) != null)
        .map((r) => `${String(r.ingredient_name).trim()} ${Number(r.inclusion)}`)
        .join("\n");
    };

    const normalizeIngredientRow = (row, index, source = "excel_import") => ({
      profile_id:
        row.profile_id ||
        `ii_import_${Date.now()}_${index}`,
      base_ingredient_id:
        row.base_ingredient_id ??
        row.ingredient_id ??
        null,
      ingredient_name:
        String(row.ingredient_name || row.name || row.ingredient || "Imported Ingredient").trim(),
      category: row.category || "custom",
      source,
      status: row.status || "active",

      currency: row.currency || "USD",
      price_basis: row.price_basis || "per_metric_ton",
      price: toSafeNumber(row.price),

      inclusion: toSafeNumber(row.inclusion),

      dm: toSafeNumber(row.dm),
      moisture: toSafeNumber(row.moisture),
      me: toSafeNumber(row.me),
      me_mj: toSafeNumber(row.me_mj),
      amen: toSafeNumber(row.amen),
      ne: toSafeNumber(row.ne),
      cp: toSafeNumber(row.cp),
      ee: toSafeNumber(row.ee),
      cf: toSafeNumber(row.cf),
      ash: toSafeNumber(row.ash),

      starch: toSafeNumber(row.starch),
      sugars: toSafeNumber(row.sugars),
      ndf: toSafeNumber(row.ndf),
      adf: toSafeNumber(row.adf),
      lignin: toSafeNumber(row.lignin),
      nsp_total: toSafeNumber(row.nsp_total),
      nsp_soluble: toSafeNumber(row.nsp_soluble),
      nsp_insoluble: toSafeNumber(row.nsp_insoluble),

      total_lys: toSafeNumber(row.total_lys),
      total_met: toSafeNumber(row.total_met),
      total_cys: toSafeNumber(row.total_cys),
      total_metcys: toSafeNumber(row.total_metcys),
      total_thr: toSafeNumber(row.total_thr),
      total_trp: toSafeNumber(row.total_trp),
      total_arg: toSafeNumber(row.total_arg),
      total_val: toSafeNumber(row.total_val),
      total_ile: toSafeNumber(row.total_ile),
      total_leu: toSafeNumber(row.total_leu),

      ca: toSafeNumber(row.ca),
      total_p: toSafeNumber(row.total_p),
      avp: toSafeNumber(row.avp),
      na: toSafeNumber(row.na),
      k: toSafeNumber(row.k),
      cl: toSafeNumber(row.cl),
      mg: toSafeNumber(row.mg),
      s: toSafeNumber(row.s),

      sid_lys: toSafeNumber(row.sid_lys),
      sid_met: toSafeNumber(row.sid_met),
      sid_cys: toSafeNumber(row.sid_cys),
      sid_metcys: toSafeNumber(row.sid_metcys),
      sid_thr: toSafeNumber(row.sid_thr),
      sid_trp: toSafeNumber(row.sid_trp),
      sid_arg: toSafeNumber(row.sid_arg),
      sid_val: toSafeNumber(row.sid_val),
      sid_ile: toSafeNumber(row.sid_ile),
      sid_leu: toSafeNumber(row.sid_leu),

      fe: toSafeNumber(row.fe),
      zn: toSafeNumber(row.zn),
      mn: toSafeNumber(row.mn),
      cu: toSafeNumber(row.cu),
      i: toSafeNumber(row.i),
      se: toSafeNumber(row.se),

      vit_a: toSafeNumber(row.vit_a),
      vit_d3: toSafeNumber(row.vit_d3),
      vit_e: toSafeNumber(row.vit_e),
      vit_k: toSafeNumber(row.vit_k),
      vit_b1: toSafeNumber(row.vit_b1),
      vit_b2: toSafeNumber(row.vit_b2),
      vit_b6: toSafeNumber(row.vit_b6),
      vit_b12: toSafeNumber(row.vit_b12),
      niacin: toSafeNumber(row.niacin),
      pantothenic_acid: toSafeNumber(row.pantothenic_acid),
      folic_acid: toSafeNumber(row.folic_acid),
      biotin: toSafeNumber(row.biotin),
      choline: toSafeNumber(row.choline),
    });

    const extractIngredientRowsFromStructuredPdfText = (text) => {
  const raw = String(text || "");
  if (!raw.trim()) return [];

  const lines = raw
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  const out = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    if (!String(current.ingredient_name || "").trim()) return;

    out.push(
      normalizeIngredientRow(
        current,
        out.length,
        "pdf_import"
      )
    );
  };

  for (const line of lines) {
    const ingredientMatch = line.match(/^Ingredient:\s*(.+)$/i);
    if (ingredientMatch) {
      pushCurrent();
      current = {
        ingredient_name: ingredientMatch[1].trim()
      };
      continue;
    }

    if (!current) continue;

    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (!m) continue;

    const left = cleanKey(m[1]);
    const right = String(m[2] || "").trim();

    const mappedKey =
      {
        category: "category",
        dm: "dm",
        moisture: "moisture",
        cp: "cp",
        me: "me",
        me_mj: "me_mj",
        amen: "amen",
        ne: "ne",
        price: "price",
        ee: "ee",
        cf: "cf",
        ash: "ash",
        starch: "starch",
        sugars: "sugars",
        ndf: "ndf",
        adf: "adf",
        lignin: "lignin",
        total_lys: "total_lys",
        total_met: "total_met",
        total_cys: "total_cys",
        total_metcys: "total_metcys",
        total_thr: "total_thr",
        total_trp: "total_trp",
        total_arg: "total_arg",
        sid_lys: "sid_lys",
        sid_met: "sid_met",
        sid_cys: "sid_cys",
        sid_metcys: "sid_metcys",
        sid_thr: "sid_thr",
        sid_trp: "sid_trp",
        sid_arg: "sid_arg",
        ca: "ca",
        total_p: "total_p",
        avp: "avp",
        na: "na",
        k: "k",
        cl: "cl",
      }[left] || null;

    if (mappedKey) {
      current[mappedKey] = right;
    }
  }

  pushCurrent();
  return out.filter((r) => String(r?.ingredient_name || "").trim());
};

    const extractIngredientRowsFromWorksheet = (sheetRows) => {
      if (!Array.isArray(sheetRows) || !sheetRows.length) return [];

      const normalized = sheetRows
        .map((r) => {
          const out = {};
          for (const [k, v] of Object.entries(r || {})) {
            out[cleanKey(k)] = v;
          }
          return out;
        })
        .filter((r) => Object.keys(r).length > 0);

      if (!normalized.length) return [];

      const hasIngredientHeader = normalized.some(
        (r) => r.ingredient_name != null || r.name != null || r.ingredient != null
      );

      const hasNutrientHeader = normalized.some((r) =>
        [
          "category",
          "dm",
          "cp",
          "me",
          "me_mj",
          "price",
          "moisture",
          "ee",
          "cf",
          "ash",
          "total_lys",
          "sid_lys",
          "ca",
          "avp",
        ].some((k) => r[k] != null)
      );

      if (!hasIngredientHeader || !hasNutrientHeader) return [];

      const out = normalized
        .map((r, index) => {
          const ingredient_name = r.ingredient_name || r.ingredient || r.name || "";
          if (!String(ingredient_name || "").trim()) return null;

          return normalizeIngredientRow(
            {
              ingredient_name,
              category: r.category,
              currency: r.currency,
              price_basis: r.price_basis,
              price: r.price,
              inclusion: r.inclusion,

              dm: r.dm,
              moisture: r.moisture,
              me: r.me,
              me_mj: r.me_mj,
              amen: r.amen,
              ne: r.ne,
              cp: r.cp,
              ee: r.ee,
              cf: r.cf,
              ash: r.ash,

              starch: r.starch,
              sugars: r.sugars,
              ndf: r.ndf,
              adf: r.adf,
              lignin: r.lignin,
              nsp_total: r.nsp_total,
              nsp_soluble: r.nsp_soluble,
              nsp_insoluble: r.nsp_insoluble,

              total_lys: r.total_lys,
              total_met: r.total_met,
              total_cys: r.total_cys,
              total_metcys: r.total_metcys,
              total_thr: r.total_thr,
              total_trp: r.total_trp,
              total_arg: r.total_arg,
              total_val: r.total_val,
              total_ile: r.total_ile,
              total_leu: r.total_leu,

              ca: r.ca,
              total_p: r.total_p,
              avp: r.avp,
              na: r.na,
              k: r.k,
              cl: r.cl,
              mg: r.mg,
              s: r.s,

              sid_lys: r.sid_lys,
              sid_met: r.sid_met,
              sid_cys: r.sid_cys,
              sid_metcys: r.sid_metcys,
              sid_thr: r.sid_thr,
              sid_trp: r.sid_trp,
              sid_arg: r.sid_arg,
              sid_val: r.sid_val,
              sid_ile: r.sid_ile,
              sid_leu: r.sid_leu,

              fe: r.fe,
              zn: r.zn,
              mn: r.mn,
              cu: r.cu,
              i: r.i,
              se: r.se,

              vit_a: r.vit_a,
              vit_d3: r.vit_d3,
              vit_e: r.vit_e,
              vit_k: r.vit_k,
              vit_b1: r.vit_b1,
              vit_b2: r.vit_b2,
              vit_b6: r.vit_b6,
              vit_b12: r.vit_b12,
              niacin: r.niacin,
              pantothenic_acid: r.pantothenic_acid,
              folic_acid: r.folic_acid,
              biotin: r.biotin,
              choline: r.choline,
            },
            index,
            "excel_import"
          );
        })
        .filter(Boolean);

      return out;
    };

   if (
  detected_mime === "application/pdf" ||
  mime === "application/pdf" ||
  detected_ext === "pdf"
) {
  let text = "";

  try {
    const pdf = await pdfParse(file.buffer);
    text = pdf?.text || "";
    console.log("[PDF_TEXT_DEBUG]", text);
  } catch (pdfErr) {
    console.error("[PDF_PARSE_ERROR]", pdfErr?.message || pdfErr);
    return res.status(400).json({
      ok: false,
      message: `PDF parse failed: ${pdfErr?.message || "Unable to read PDF"}`,
      meta: {
        route_version: INGEST_ROUTE_VERSION,
        detected_mime,
        detected_ext,
        filename,
      },
    });
  }

  const ingredient_rows = extractIngredientRowsFromStructuredPdfText(text);
  const rep = extractReportedFromPdfText(text);

  let f = extractFormulaFromPdfText(text);

  if (isSuspiciousPdfFormulaExtraction(f)) {
    const fallback = fallbackExtractFormulaFromPdfText(text);

    if ((fallback?.formula_lines_count || 0) > (f?.formula_lines_count || 0)) {
      console.log("[INGEST_AUDIT] fallback_applied", {
        filename,
        previous_method: f?.method,
        fallback_method: fallback?.method,
        previous_lines: f?.formula_lines_count,
        fallback_lines: fallback?.formula_lines_count,
        previous_head: f?.formula_head,
        fallback_head: fallback?.formula_head,
        route_version: INGEST_ROUTE_VERSION,
      });

      f = fallback;
    }
  }

  console.log("[INGEST_AUDIT] pdf_parsed", {
    filename,
    text_len: text.length,
    candidates: f.candidates,
    gated_count: f.gated_count,
    resolved_count: f.resolved_count,
    unresolved_count: f.unresolved_count,
    formula_lines: f.formula_lines_count,
    picked_total: Number((f.picked_total || 0).toFixed(4)),
    method: f.method,
    normalized: f.normalized,
    normalize_factor: Number((f.normalize_factor ?? 1).toFixed(6)),
    chosen_column: f.chosen_column,
    score_reason: f.score_reason,
    reported_keys: Object.keys(rep.reported_nutrients || {}).length,
    reported_total: rep.reported_total,
    ingredient_rows: ingredient_rows.length,
    route_version: INGEST_ROUTE_VERSION,
  });

  if (INGEST_DEBUG && f.debug) {
    console.log("[INGEST_AUDIT] debug", f.debug);
  }

  console.log("[INGEST_AUDIT] formula_head", { head: f.formula_head });

  const meta = {
    route_version: INGEST_ROUTE_VERSION,
    detected_mime,
    detected_ext,
    text_len: text.length,
    formula_lines: f.formula_lines_count,
    picked_total: Number((f.picked_total || 0).toFixed(4)),
    method: f.method,
    normalized: f.normalized,
    normalize_factor: f.normalize_factor,
    chosen_column: f.chosen_column,
    gated_count: f.gated_count,
    resolved_count: f.resolved_count,
    unresolved_count: f.unresolved_count,
    reported_nutrients: rep.reported_nutrients || {},
    reported_total: rep.reported_total,
    ingredient_rows: ingredient_rows.length,
  };

  if (INGEST_DEBUG && f.debug) {
    meta.debug = f.debug;
  }

  const safe_formula_text = Array.isArray(f?.resolved_rows) && f.resolved_rows.length
  ? f.resolved_rows
      .filter((r) => r && r.ingredient_id && Number.isFinite(Number(r.inclusion)))
      .map((r) => `${String(r.ingredient_id).trim()} ${Number(r.inclusion)}`)
      .join("\n")
  : (f.formula_text || buildFormulaTextFromIngredientRows(ingredient_rows) || "");

return res.json({
  ok: true,
  formula_text: safe_formula_text,
  resolved_rows: f.resolved_rows || [],
  ingredient_rows,
  ingest: { filename, contentType: "application/pdf" },
  meta,
});
}
    if (
      detected_ext === "xlsx" ||
      detected_ext === "xls" ||
      detected_ext === "csv" ||
      detected_mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      detected_mime === "application/vnd.ms-excel" ||
      String(mime).includes("spreadsheetml") ||
      String(mime).includes("excel") ||
      String(mime).includes("csv")
    ) {
      const wb = xlsx.read(file.buffer, { type: "buffer" });
      const sheetName = wb.SheetNames?.[0];
      const ws = wb.Sheets?.[sheetName];

      const headerRows = xlsx.utils.sheet_to_json(ws, { defval: null, raw: false });
      const ingredient_rows = extractIngredientRowsFromWorksheet(headerRows);

      if (ingredient_rows.length) {
        return res.json({
          ok: true,
          formula_text: buildFormulaTextFromIngredientRows(ingredient_rows) || "",
          ingredient_rows,
          ingest: { filename, contentType: detected_mime || mime },
          meta: {
            route_version: INGEST_ROUTE_VERSION,
            detected_mime,
            detected_ext,
            sheet: sheetName,
            rows: headerRows.length,
            items: ingredient_rows.length,
            mode: "ingredient_rows",
            reported_nutrients: {},
            reported_total: null,
          },
        });
      }

      const rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: false });

      const items = [];
      for (const row of rows) {
        if (!row || row.length < 2) continue;
        const name = String(row[0] ?? "").trim();
        const inc = toNum(row[1]);
        if (!name || inc == null) continue;
        if (inc < 0.001) continue;
        if (/^total$/i.test(name)) continue;
        if (looksJunky(name)) continue;

        const canonical = tryResolveToCanonical(name);
        if (!canonical) continue;

        items.push({
          display: normalizeDisplayName(name),
          canonical,
          inclusion: inc,
        });
      }

      const map = new Map();
      for (const it of items) {
        const prev = map.get(it.canonical);
        if (!prev || it.inclusion > prev.inclusion) map.set(it.canonical, it);
      }

      const out = Array.from(map.values()).sort((a, b) => b.inclusion - a.inclusion);
      const formula_text = out.map((it) => `${it.display} ${it.inclusion}`).join("\n");

      return res.json({
        ok: true,
        formula_text,
        ingredient_rows: [],
        ingest: { filename, contentType: detected_mime || mime },
        meta: {
          route_version: INGEST_ROUTE_VERSION,
          detected_mime,
          detected_ext,
          rows: rows.length,
          items: out.length,
          mode: "formula_text",
          reported_nutrients: {},
          reported_total: null,
        },
      });
    }

    if (
      String(detected_mime || mime).startsWith("image/") ||
      requested_kind === "image"
    ) {
      return res.status(415).json({
        ok: false,
        message:
          "Image ingest is not wired in this backend route yet. PDF and Excel are supported here; image OCR needs a separate OCR implementation before Ingredient Intelligence import can work.",
        meta: {
          route_version: INGEST_ROUTE_VERSION,
          detected_mime,
          detected_ext,
          requested_kind,
        },
      });
    }

    return res.status(415).json({
      ok: false,
      message: `Unsupported file type: ${detected_mime || mime} (${detected_ext || "unknown"})`,
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  } catch (e) {
    console.error("[INGEST_AUDIT] error", e?.message || e);
    return res.status(500).json({
      ok: false,
      message: e?.message || "Ingest failed",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

function qcSeverityRank(status) {
  const rank = { normal: 0, watch: 1, outlier: 2, critical: 3 };
  return rank[String(status || "normal")] ?? 0;
}

function qcWorseStatus(a, b) {
  return qcSeverityRank(b) > qcSeverityRank(a) ? b : a;
}

function qcPushReason(reasons, reason) {
  if (!reason) return;
  if (!Array.isArray(reasons)) return;
  if (!reasons.includes(reason)) reasons.push(reason);
}

function qcCompareVsBaseline(result, baseline = {}, actual = {}) {
  const keys = [
    "moisture",
    "dm",
    "cp",
    "ee",
    "cf",
    "ash",
    "starch",
    "sugars",
    "me",
    "me_kcal",
    "me_mj",
    "ca",
    "total_p",
    "avp",
    "na",
    "k",
    "cl",
    "total_lys",
    "total_met",
    "total_metcys",
    "total_thr",
    "total_trp",
    "total_arg",
  ];

  for (const key of keys) {
    const b = toNum(baseline?.[key]);
    const a = toNum(actual?.[key]);
    if (b == null || a == null || b === 0) continue;

    const pct = Math.abs(((a - b) / b) * 100);

    if (pct >= 6) {
      result.screening_status = qcWorseStatus(result.screening_status, "critical");
      result.screening_score += 30;
      qcPushReason(result.screening_reasons, `${key}_critical_deviation`);
    } else if (pct >= 4) {
      result.screening_status = qcWorseStatus(result.screening_status, "outlier");
      result.screening_score += 20;
      qcPushReason(result.screening_reasons, `${key}_outlier_deviation`);
    } else if (pct >= 2) {
      result.screening_status = qcWorseStatus(result.screening_status, "watch");
      result.screening_score += 10;
      qcPushReason(result.screening_reasons, `${key}_watch_deviation`);
    }
  }
}

function qcEvaluateRecord(qc_record) {
  const out = {
    ...qc_record,
    nutrients: normalizeQcNutrients(qc_record?.nutrients || qc_record?.reported_nutrients || {}),
    reported_nutrients: normalizeQcNutrients(qc_record?.reported_nutrients || qc_record?.nutrients || {}),
    baseline_nutrients: normalizeQcNutrients(qc_record?.baseline_nutrients || {}),
    screening_status: String(qc_record?.screening_status || "normal"),
    decision_status: String(qc_record?.decision_status || "pending"),
    screening_score: Number(qc_record?.screening_score || 0),
    screening_reasons: Array.isArray(qc_record?.screening_reasons) ? [...qc_record.screening_reasons] : [],
    trend_signals: Array.isArray(qc_record?.trend_signals) ? [...qc_record.trend_signals] : [],
  };

  if (!Object.keys(out.nutrients || {}).length) {
    out.screening_status = qcWorseStatus(out.screening_status, "watch");
    out.screening_score += 10;
    qcPushReason(out.screening_reasons, "missing_key_analysis_fields");
  }

  const moisture = toNum(out.nutrients?.moisture);
  const dm = toNum(out.nutrients?.dm);
  if (moisture != null && dm != null) {
    const expectedDm = 100 - moisture;
    const diff = Math.abs(expectedDm - dm);
    if (diff > 3) {
      out.screening_status = qcWorseStatus(out.screening_status, "critical");
      out.screening_score += 25;
      qcPushReason(out.screening_reasons, "dm_consistency_failed");
    } else if (diff > 1) {
      out.screening_status = qcWorseStatus(out.screening_status, "watch");
      out.screening_score += 8;
      qcPushReason(out.screening_reasons, "dm_consistency_warning");
    }
  }

  const totalMet = toNum(out.nutrients?.total_met);
  const totalMetCys = toNum(out.nutrients?.total_metcys);
  if (totalMet != null && totalMetCys != null && totalMetCys < totalMet) {
    out.screening_status = qcWorseStatus(out.screening_status, "critical");
    out.screening_score += 30;
    qcPushReason(out.screening_reasons, "metcys_less_than_met");
  }

  qcCompareVsBaseline(out, out.baseline_nutrients || {}, out.nutrients || {});

  if (out.decision_status === "pending") {
    out.status = `screened_${out.screening_status}`;
  }

  return out;
}

function getQcStore() {
  const store = readJsonFileSafe(getQcSamplesFile(), { samples: [] });
  if (!Array.isArray(store.samples)) store.samples = [];
  return store;
}

function getQcSampleById(sample_id) {
  const id = String(sample_id || "").trim();
  const store = getQcStore();
  return store.samples.find((x) => String(x?.sample_id || "").trim() === id) || null;
}

function appendQcAudit(event) {
  const auditFile = getQcAuditFile();
  const audit = readJsonFileSafe(auditFile, { events: [] });
  if (!Array.isArray(audit.events)) audit.events = [];
  audit.events.push({
    at: new Date().toISOString(),
    ...cleanObject(event || {}),
  });
  writeJsonFilePretty(auditFile, audit);
}

function updateQcDecision(sample_id, patch = {}) {
  const existing = getQcSampleById(sample_id);
  if (!existing) return null;

  const merged = {
    ...existing,
    ...cleanObject(patch),
    updated_at: new Date().toISOString(),
  };

  const persisted = saveQcRecord(merged);
  appendQcAudit({
    event_type: "qc_review_decision",
    sample_id: merged.sample_id,
    ingredient_id: merged.ingredient_id || null,
    decision_status: merged.decision_status || null,
    screening_status: merged.screening_status || null,
    reviewed_by: merged.reviewed_by || null,
  });

  return { qc_record: merged, persisted };
}

router.post("/v1/qc/intake", async (req, res) => {
  try {
    const body = req.body || {};

    const sample_id = String(body.sample_id || "").trim();
    const entered_name = String(
      body.entered_name || body.ingredient_name || body.raw_name || ""
    ).trim();

    const submitted_by = String(body.submitted_by || "unknown").trim();
    const source = String(body.source || "manual_entry").trim();

    const matched_ingredient_id_raw = String(body.matched_ingredient_id || "").trim();
    const matched_display_name_raw = String(body.matched_display_name || "").trim();

    if (!sample_id) {
      return res.status(400).json({
        ok: false,
        error: "QC_SAMPLE_ID_REQUIRED",
        message: "sample_id is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    if (!entered_name && !matched_ingredient_id_raw) {
      return res.status(400).json({
        ok: false,
        error: "QC_INGREDIENT_REQUIRED",
        message: "entered_name or matched_ingredient_id is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const nutrients = normalizeQcNutrients(body.nutrients || {});
    const ctx = getQcIngredientContext({
      entered_name,
      matched_ingredient_id: matched_ingredient_id_raw,
      matched_display_name: matched_display_name_raw,
      nutrients
    });

    let qc_record = buildQcRecord({
      sample_id,
      entered_name: entered_name || ctx.matched_display_name || ctx.ingredient_id || "",
      matched_ingredient_id: ctx.ingredient_id,
      matched_display_name: ctx.matched_display_name,
      source,
      submitted_by,
      baseline_nutrients: normalizeQcNutrients(
        body.baseline_nutrients || body.baseline || ctx.baseline_nutrients || {}
      ),
      nutrients,
      intake_type: "qc_manual_entry",
    });

    qc_record = qcEvaluateRecord(qc_record);
    const persisted = saveQcRecord(qc_record);

    if (INGEST_DEBUG) {
      console.log("[QC_INTAKE]", qc_record);
    }

    return res.json({
      ok: true,
      qc_record,
      meta: {
        route_version: INGEST_ROUTE_VERSION,
        sample_file: persisted.sampleFile,
      },
    });
  } catch (e) {
    console.error("[QC_INTAKE] error", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "QC_INTAKE_FAILED",
      message: e?.message || "QC intake failed",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.post("/v1/qc/intake/file", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const body = req.body || {};

    if (!file) {
      return res.status(400).json({
        ok: false,
        error: "QC_FILE_REQUIRED",
        message: "No file uploaded (field name must be 'file').",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const sample_id = String(body.sample_id || "").trim();
    const entered_name = String(
      body.entered_name || body.ingredient_name || body.raw_name || ""
    ).trim();
    const submitted_by = String(body.submitted_by || "unknown").trim();

    const matched_ingredient_id_raw = String(body.matched_ingredient_id || "").trim();
    const matched_display_name_raw = String(body.matched_display_name || "").trim();

    if (!sample_id) {
      return res.status(400).json({
        ok: false,
        error: "QC_SAMPLE_ID_REQUIRED",
        message: "sample_id is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    if (!entered_name && !matched_ingredient_id_raw) {
      return res.status(400).json({
        ok: false,
        error: "QC_INGREDIENT_REQUIRED",
        message: "entered_name or matched_ingredient_id is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const filename = file.originalname || "upload";
    const mime = file.mimetype || "application/octet-stream";

    let detected = null;
    try {
      detected = await fileTypeFromBuffer(file.buffer);
    } catch {
      detected = null;
    }

    const detected_mime = detected?.mime || mime;
    const detected_ext = detected?.ext || "";

    if (
      detected_mime === "application/pdf" ||
      mime === "application/pdf" ||
      detected_ext === "pdf"
    ) {
      const pdf = await pdfParse(file.buffer);
      const text = pdf?.text || "";
      const rep = extractReportedFromPdfText(text);
      const nutrients = normalizeQcNutrients(rep.reported_nutrients || {});

      const ctx = getQcIngredientContext({
        entered_name,
        matched_ingredient_id: matched_ingredient_id_raw,
        matched_display_name: matched_display_name_raw,
        nutrients
      });

      let qc_record = buildQcRecord({
        sample_id,
        entered_name: entered_name || ctx.matched_display_name || ctx.ingredient_id || "",
        matched_ingredient_id: ctx.ingredient_id,
        matched_display_name: ctx.matched_display_name,
        source: String(body.source || "pdf_upload").trim(),
        submitted_by,
        baseline_nutrients: ctx.baseline_nutrients,
        nutrients,
        intake_type: "qc_file_pdf",
        filename,
        content_type: detected_mime,
        parse_meta: {
          detected_ext,
          reported_total: rep.reported_total,
          reported_keys: Object.keys(rep.reported_nutrients || {}).length,
          text_len: text.length,
        },
      });

      qc_record = qcEvaluateRecord(qc_record);
      const persisted = saveQcRecord(qc_record);

      if (INGEST_DEBUG) {
        console.log("[QC_FILE_INTAKE][PDF]", qc_record);
      }

      return res.json({
        ok: true,
        qc_record,
        meta: {
          route_version: INGEST_ROUTE_VERSION,
          sample_file: persisted.sampleFile,
        },
      });
    }

    if (
      detected_ext === "xlsx" ||
      detected_mime ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      String(mime).includes("spreadsheetml")
    ) {
      const wb = xlsx.read(file.buffer, { type: "buffer" });
      const sheetName = wb.SheetNames?.[0];
      const ws = wb.Sheets?.[sheetName];
      const rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: false });

      const nutrients = extractQcNutrientsFromXlsxRows(rows);
      const ctx = getQcIngredientContext({
        entered_name,
        matched_ingredient_id: matched_ingredient_id_raw,
        matched_display_name: matched_display_name_raw,
        nutrients
      });

      let qc_record = buildQcRecord({
        sample_id,
        entered_name: entered_name || ctx.matched_display_name || ctx.ingredient_id || "",
        matched_ingredient_id: ctx.ingredient_id,
        matched_display_name: ctx.matched_display_name,
        source: String(body.source || "excel_upload").trim(),
        submitted_by,
        baseline_nutrients: ctx.baseline_nutrients,
        nutrients,
        intake_type: "qc_file_xlsx",
        filename,
        content_type: detected_mime || mime,
        parse_meta: {
          detected_ext,
          sheet_name: sheetName || null,
          rows: rows.length,
          reported_keys: Object.keys(nutrients || {}).length,
        },
      });

      qc_record = qcEvaluateRecord(qc_record);
      const persisted = saveQcRecord(qc_record);

      if (INGEST_DEBUG) {
        console.log("[QC_FILE_INTAKE][XLSX]", qc_record);
      }

      return res.json({
        ok: true,
        qc_record,
        meta: {
          route_version: INGEST_ROUTE_VERSION,
          sample_file: persisted.sampleFile,
        },
      });
    }

    return res.status(415).json({
      ok: false,
      error: "QC_UNSUPPORTED_FILE_TYPE",
      message: `Unsupported file type: ${detected_mime || mime} (${detected_ext || "unknown"})`,
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  } catch (e) {
    console.error("[QC_FILE_INTAKE] error", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "QC_FILE_INTAKE_FAILED",
      message: e?.message || "QC file intake failed",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.post("/v1/qc/intake/live", async (req, res) => {
  try {
    const body = req.body || {};

    const sample_id = String(body.sample_id || "").trim();
    const entered_name = String(
      body.entered_name || body.ingredient_name || body.raw_name || ""
    ).trim();

    const submitted_by = String(
      body.submitted_by || body.source_system || "system"
    ).trim();
    const source = String(body.source || "live_feed").trim();
    const source_system = String(body.source_system || "unknown").trim();

    const matched_ingredient_id_raw = String(body.matched_ingredient_id || "").trim();
    const matched_display_name_raw = String(body.matched_display_name || "").trim();

    if (!sample_id) {
      return res.status(400).json({
        ok: false,
        error: "QC_SAMPLE_ID_REQUIRED",
        message: "sample_id is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    if (!entered_name && !matched_ingredient_id_raw) {
      return res.status(400).json({
        ok: false,
        error: "QC_INGREDIENT_REQUIRED",
        message: "entered_name or matched_ingredient_id is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const nutrients = normalizeQcNutrients(body.nutrients || {});
    const ctx = getQcIngredientContext({
      entered_name,
      matched_ingredient_id: matched_ingredient_id_raw,
      matched_display_name: matched_display_name_raw,
      nutrients
    });

    let qc_record = buildQcRecord({
      sample_id,
      entered_name: entered_name || ctx.matched_display_name || ctx.ingredient_id || "",
      matched_ingredient_id: ctx.ingredient_id,
      matched_display_name: ctx.matched_display_name,
      source,
      submitted_by,
      baseline_nutrients: ctx.baseline_nutrients,
      nutrients,
      intake_type: "qc_live_feed",
      source_system,
      parse_meta: cleanObject({
        feed_timestamp: body.feed_timestamp || null,
        device_id: body.device_id || null,
        connector_id: body.connector_id || null,
      }),
    });

    qc_record = qcEvaluateRecord(qc_record);
    const persisted = saveQcRecord(qc_record);

    if (INGEST_DEBUG) {
      console.log("[QC_LIVE_INTAKE]", qc_record);
    }

    return res.json({
      ok: true,
      qc_record,
      meta: {
        route_version: INGEST_ROUTE_VERSION,
        sample_file: persisted.sampleFile,
      },
    });
  } catch (e) {
    console.error("[QC_LIVE_INTAKE] error", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "QC_LIVE_INTAKE_FAILED",
      message: e?.message || "QC live intake failed",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

function buildImpactProfile(baseProfile = {}, overrideProfile = {}) {
  const base = normalizeQcNutrients(baseProfile || {});
  const normalizedOverride = normalizeQcNutrients(overrideProfile || {});
  const override = {};

  for (const [k, v] of Object.entries(normalizedOverride)) {
    const n = toNum(v);
    if (n == null) continue;

    const baseHasKey = Object.prototype.hasOwnProperty.call(base, k) && base[k] != null;
    if (!baseHasKey && n === 0) continue;
    override[k] = n;
  }

  const merged = {
    ...base,
    ...override,
  };

  if (merged.me == null && merged.me_kcal != null) merged.me = merged.me_kcal;
  if (merged.me_kcal == null && merged.me != null) merged.me_kcal = merged.me;
  if (merged.me_mj == null && merged.me_kcal != null) {
    merged.me_mj = Number((merged.me_kcal / 239.005736).toFixed(4));
  }

  if (merged.dm != null && override.dm != null) {
    merged.moisture = Number((100 - merged.dm).toFixed(4));
  } else if (merged.moisture != null && override.moisture != null) {
    merged.dm = Number((100 - merged.moisture).toFixed(4));
  }

  return merged;
}

function buildImpactDiffRows(beforeProfile = {}, afterProfile = {}) {
  const keys = [
    "moisture","dm","cp","ee","cf","ash","starch","sugars",
    "me","me_kcal","me_mj",
    "ca","total_p","avp","na","k","cl","mg","s","deb",
    "total_lys","total_met","total_metcys","total_thr","total_trp","total_arg","total_val","total_ile","total_leu",
    "sid_lys","sid_met","sid_metcys","sid_thr","sid_trp","sid_arg","sid_val","sid_ile","sid_leu"
  ];

  return keys
    .filter((k) => beforeProfile[k] != null || afterProfile[k] != null)
    .map((k) => {
      const before = toNum(beforeProfile[k]);
      const after = toNum(afterProfile[k]);

      const bothMissing = before == null && after == null;
      const nullToZero =
        (before == null && after === 0) ||
        (after == null && before === 0);

      let delta = null;
      let pct_delta = null;
      let changed = false;

      if (!bothMissing && !nullToZero) {
        if (before != null && after != null) {
          delta = Number((after - before).toFixed(4));
          changed = Math.abs(delta) > 0.000001;

          if (Math.abs(before) > 1e-9) {
            pct_delta = Number((((after - before) / before) * 100).toFixed(4));
          }
        } else {
          changed = true;
        }
      }

      return {
        nutrient: k,
        before,
        after,
        delta,
        pct_delta,
        changed,
      };
    });
}

function buildImpactRiskSummary(diffRows = []) {
  const criticalKeys = new Set([
    "dm", "cp", "me", "me_kcal", "ca", "avp",
    "total_lys", "total_met", "total_metcys", "total_thr", "total_trp", "total_arg",
    "sid_lys", "sid_met", "sid_metcys", "sid_thr", "sid_trp", "sid_arg"
  ]);

  const changed = diffRows.filter((r) => r.changed);
  const critical_changed = changed.filter((r) => criticalKeys.has(r.nutrient));

  const material_thresholds = {
    dm: 0.5,
    moisture: 0.5,
    cp: 0.3,
    me: 25,
    me_kcal: 25,
    me_mj: 0.1,
    ca: 0.03,
    avp: 0.02,
    na: 0.01,
    total_lys: 0.03,
    total_met: 0.02,
    total_metcys: 0.03,
    total_thr: 0.03,
    total_trp: 0.01,
    total_arg: 0.03,
    sid_lys: 0.03,
    sid_met: 0.02,
    sid_metcys: 0.03,
    sid_thr: 0.03,
    sid_trp: 0.01,
    sid_arg: 0.03,
  };

  const materially_changed = changed.filter((r) => {
    if (r.delta == null) return false;
    const th = material_thresholds[r.nutrient];
    if (th == null) return Math.abs(r.delta) > 0.000001;
    return Math.abs(r.delta) >= th;
  });

  let publish_risk = "low";
  if (materially_changed.some((r) => criticalKeys.has(r.nutrient))) publish_risk = "medium";
  if (materially_changed.some((r) => ["cp", "me", "me_kcal", "ca", "avp", "sid_lys", "sid_met", "sid_metcys"].includes(r.nutrient))) {
    publish_risk = "high";
  }

  return {
    changed_count: changed.length,
    critical_changed_count: critical_changed.length,
    materially_changed_count: materially_changed.length,
    publish_risk,
    recommendation:
      publish_risk === "high"
        ? "Run formula-level impact before publish"
        : publish_risk === "medium"
        ? "Review affected nutrients before publish"
        : "Ingredient-level change appears low risk, but formula-level impact is still recommended",
    critical_changed_nutrients: critical_changed.map((x) => x.nutrient),
    materially_changed_nutrients: materially_changed.map((x) => x.nutrient),
  };
}

function getQcOverridesFile() {
  return require("path").resolve(__dirname, "../../data/qc/ingredient_overrides.us.json");
}

function readOverridesStore() {
  const file = getQcOverridesFile();
  const store = readJsonFileSafe(file, { overrides: [] });
  if (!Array.isArray(store.overrides)) store.overrides = [];
  return { file, store };
}

function writeOverridesStore(store) {
  const file = getQcOverridesFile();
  writeJsonFilePretty(file, store);
  return file;
}

function getActiveOverrideForIngredient(store, ingredient_id) {
  return (store.overrides || []).find(
    (x) =>
      String(x?.ingredient_id || "").trim() === String(ingredient_id || "").trim() &&
      x?.active === true
  ) || null;
}

function deactivateActiveOverride(store, ingredient_id, reason = "superseded") {
  let changed = false;
  for (const row of store.overrides || []) {
    if (
      String(row?.ingredient_id || "").trim() === String(ingredient_id || "").trim() &&
      row?.active === true
    ) {
      row.active = false;
      row.status = "rolled_back";
      row.deactivated_at = new Date().toISOString();
      row.deactivation_reason = reason;
      changed = true;
    }
  }
  return changed;
}

function buildEffectiveIngredientProfile(baseRow = {}, overrideProfile = null) {
  const baseline = toReviewNutrientProfile(baseRow);
  if (!overrideProfile || typeof overrideProfile !== "object") return baseline;
  return buildImpactProfile(baseline, overrideProfile);
}

function getUsIngredientOverrideFile() {
  return require("path").resolve(__dirname, "../../data/qc/ingredients.poultry.us.override.v1.json");
}

function readUsIngredientOverrideStore() {
  const file = getUsIngredientOverrideFile();
  const store = readJsonFileSafe(file, {
    meta: {
      name: "Nutrix US Ingredient Override Layer",
      version: "v1",
      scope: "poultry_us",
      description: "Nutritionist-managed override layer on top of protected US ingredient DB"
    },
    ingredients: {}
  });

  if (!store.meta || typeof store.meta !== "object") {
    store.meta = {
      name: "Nutrix US Ingredient Override Layer",
      version: "v1",
      scope: "poultry_us"
    };
  }

  if (!store.ingredients || typeof store.ingredients !== "object") {
    store.ingredients = {};
  }

  return { file, store };
}

function writeUsIngredientOverrideStore(store) {
  const file = getUsIngredientOverrideFile();
  writeJsonFilePretty(file, store);
  return file;
}

function buildFullOverrideRecord(baseRow = {}, ingredient_id, override_profile = {}, meta = {}) {
  const baseClone = JSON.parse(JSON.stringify(baseRow || {}));
  const mergedProfile = buildImpactProfile(toReviewNutrientProfile(baseRow), override_profile || {});

  for (const [k, v] of Object.entries(mergedProfile)) {
    baseClone[k] = v;
  }

  baseClone._override_meta = {
    active: true,
    ingredient_id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...meta
  };

  return baseClone;
}

function getBroilerStarterFormulaSetFile() {
  return require("path").resolve(__dirname, "../../../data/formula_sets/broiler_starters.json");
}

function getFormulaFileById(formula_id) {
  return require("path").resolve(__dirname, `../../../data/formulas/${formula_id}.json`);
}

function readFormulaJson(filePath) {
  return readJsonFileSafe(filePath, null);
}

function parseFormulaTextToIngredients(formula_text) {
  const lines = String(formula_text || "")
    .split(/\r?\n/)
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  const ingredients = [];

  for (const line of lines) {
    const m = line.match(/^(.+?)\s+([0-9]+(?:\.[0-9]+)?)$/);
    if (!m) continue;

    const display_name = String(m[1] || "").trim();
    const inclusion = toNum(m[2]);
    if (!display_name || inclusion == null) continue;

    const canonical = tryResolveToCanonical(display_name);

    ingredients.push({
      ingredient_id: canonical || cleanName(display_name).replace(/\s+/g, "_"),
      display_name,
      inclusion,
    });
  }

  return ingredients;
}

function getIngredientFamiliesFile() {
  return require("path").resolve(__dirname, "../../data/ingredient_families.json");
}

function buildDefaultIngredientFamilies() {
  return {
    corn_family: [
      "corn",
      "maize",
      "corn grain",
      "corn grain avg",
      "corn grain average",
      "corn_grain_avg"
    ],
    soybean_meal_family: [
      "sbm",
      "sbm44",
"sbm 44",
"sbm 44%",
"soybean meal 44",
"soybean meal 44 cp",
"soybean meal 44.5",
"soybean meal 44.5 cp",
"soybean_meal_44_5_cp",
      "sbm46",
      "sbm 46",
      "sbm46.5",
      "sbm 46.5",
      "sbm48",
      "sbm 48",
      "soybean meal",
      "soybean meal 46.5 cp",
      "soybean meal 48 cp",
      "soybean_meal",
      "soybean_meal_46_5_cp",
      "soybean_meal_48_cp"
    ],
    oil_family: [
      "oil",
      "vegetable_oil",
      "vegetable oil",
      "soybean_oil",
      "soybean oil",
      "soyabean oil",
      "soya oil"
    ],
    limestone_family: [
      "limestone",
      "calcium_carbonate",
      "calcium carbonate"
    ],
    dcp_family: [
      "dcp",
      "dicalcium_phosphate",
      "dicalcium phosphate"
    ],
    salt_family: [
      "salt",
      "sodium_chloride",
      "sodium chloride",
      "nacl"
    ],
    dl_met_family: [
      "dlm",
      "dl_met",
      "dl met",
      "dl methionine",
      "dl-methionine"
    ],
    l_lys_hcl_family: [
      "lys",
      "l_lys_hcl",
      "l lys hcl",
      "l-lysine hcl",
      "lysine hcl"
    ],
    l_thr_family: [
      "l_thr",
      "thr",
      "threonine",
      "l-threonine"
    ],
    wheat_family: [
      "wheat",
      "wheat grain",
      "wheat_grain"
    ],
    wheat_bran_family: [
      "wheat bran",
      "wheat_bran",
      "bran",
      "pollard"
    ],
    wheat_midds_family: [
      "wheat midds",
      "wheat middlings",
      "wheat_midds"
    ],
    rice_broken_family: [
      "rice broken",
      "broken rice",
      "rice_broken"
    ],
    rice_polish_family: [
      "rice polish",
      "rice polishings",
      "rice_polish"
    ],
    meat_meal_family: [
      "meat meal",
      "meat_meal"
    ],
    mbm_family: [
      "mbm",
      "meat bone meal",
      "meat and bone meal",
      "meat_bone_meal"
    ],
    poultry_byproduct_family: [
      "poultry by-product meal",
      "poultry by product meal",
      "poultry_byproduct_meal",
      "pbm"
    ],
    ddgs_family: [
      "ddgs",
      "corn ddgs"
    ],
    canola_meal_family: [
      "canola meal",
      "rapeseed meal",
      "canola_meal",
      "rapeseed_meal"
    ],
    sunflower_meal_family: [
      "sunflower meal",
      "sunflower_meal"
    ],
    fish_meal_family: [
      "fish meal",
      "fish_meal"
    ],
    corn_gluten_family: [
      "cg",
      "c g",
      "corn gluten",
      "corn gluten meal",
      "corn_gluten"
    ],
    enzyme_family: [
      "enzyme_products",
      "enzyme",
      "enzymes",
      "phytase",
      "protease",
      "xylanase"
    ],
    toxin_binder_family: [
      "toxin_binders",
      "toxin binder",
      "toxin binders",
      "mycotoxin binder",
      "toxin_binder"
    ],
    premix_family: [
      "premix",
      "premixes",
      "vitamin premix",
      "mineral premix",
      "vitamin_premix",
      "mineral_premix"
    ]
  };
}

function loadIngredientFamilies() {
  const file = getIngredientFamiliesFile();
  const fallback = buildDefaultIngredientFamilies();
  const json = readJsonFileSafe(file, fallback);
  return json && typeof json === "object" ? json : fallback;
}

function resolveCanonicalIngredientForImpact(rawId) {
  if (!rawId) return null;

  const raw = String(rawId).trim();
  if (!raw) return null;

  const cleaned = cleanName(raw);

  const direct = tryResolveToCanonical(raw);
  if (direct) return direct;

  const cleanedResolved = tryResolveToCanonical(cleaned);
  if (cleanedResolved) return cleanedResolved;

  const explicitCanonicalMap = {
    corn: "corn",
    maize: "corn",
    "corn grain": "corn",
    "corn grain avg": "corn",
    "corn grain average": "corn",
    "corn grain (average)": "corn",
    corn_grain_avg: "corn",

    sbm: "soybean_meal",
    sbm44: "soybean_meal_44_5_cp",
"sbm 44": "soybean_meal_44_5_cp",
"sbm 44%": "soybean_meal_44_5_cp",
"soybean meal 44": "soybean_meal_44_5_cp",
"soybean meal 44 cp": "soybean_meal_44_5_cp",
"soybean meal 44.5": "soybean_meal_44_5_cp",
"soybean meal 44.5 cp": "soybean_meal_44_5_cp",
soybean_meal_44_5_cp: "soybean_meal_44_5_cp",
    sbm46: "soybean_meal_46_5_cp",
    "sbm 46": "soybean_meal_46_5_cp",
    sbm465: "soybean_meal_46_5_cp",
    "sbm 46.5": "soybean_meal_46_5_cp",
    sbm48: "soybean_meal_48_cp",
    "sbm 48": "soybean_meal_48_cp",
    "soybean meal": "soybean_meal",
    "soybean meal 46": "soybean_meal_46_5_cp",
    "soybean meal 46 5": "soybean_meal_46_5_cp",
    "soybean meal 46.5": "soybean_meal_46_5_cp",
    "soybean meal 46.5 cp": "soybean_meal_46_5_cp",
    "soybean meal 48": "soybean_meal_48_cp",
    "soybean meal 48 cp": "soybean_meal_48_cp",
    soybean_meal_46_5_cp: "soybean_meal_46_5_cp",
    soybean_meal_48_cp: "soybean_meal_48_cp",

    oil: "vegetable_oil",
    "veg oil": "vegetable_oil",
    "vegetable oil": "vegetable_oil",
    "soybean oil": "soybean_oil",
    "soyabean oil": "soybean_oil",
    "soya oil": "soybean_oil",

    limestone: "limestone",
    "calcium carbonate": "limestone",

    dcp: "dicalcium_phosphate",
    "dicalcium phosphate": "dicalcium_phosphate",

    salt: "salt",
    "sodium chloride": "salt",

    dlm: "dl_met",
    "dl met": "dl_met",
    "dl methionine": "dl_met",
    "dl-methionine": "dl_met",

    lys: "l_lys_hcl",
    "l lys": "l_lys_hcl",
    "l lys hcl": "l_lys_hcl",
    "l-lysine hcl": "l_lys_hcl",
    "lysine hcl": "l_lys_hcl",
    l_lys_hcl: "l_lys_hcl",

    "wheat midds": "wheat_midds",
    "wheat middlings": "wheat_midds",
    wheat_midds: "wheat_midds",

    "meat meal": "meat_meal",
    meat_meal: "meat_meal",

    mbm: "meat_bone_meal",
    "meat bone meal": "meat_bone_meal",
    "meat and bone meal": "meat_bone_meal",
    meat_bone_meal: "meat_bone_meal",

    "poultry by-product meal": "poultry_byproduct_meal",
    "poultry by product meal": "poultry_byproduct_meal",
    pbm: "poultry_byproduct_meal",
    poultry_byproduct_meal: "poultry_byproduct_meal",

    ddgs: "ddgs",
    "corn ddgs": "ddgs",

    "rice polish": "rice_polish",
    "rice polishings": "rice_polish",
    rice_polish: "rice_polish",

    phytase: "enzyme_products",
    protease: "enzyme_products",
    xylanase: "enzyme_products",
    enzyme: "enzyme_products",
    enzymes: "enzyme_products",

    "toxin binder": "toxin_binders",
    "toxin binders": "toxin_binders",
    "mycotoxin binder": "toxin_binders",
    toxin_binder: "toxin_binders",

    premix: "premixes",
    premixes: "premixes",
    "vitamin premix": "premixes",
    "mineral premix": "premixes"
  };

  if (explicitCanonicalMap[cleaned]) {
    return explicitCanonicalMap[cleaned];
  }

  return cleaned || null;
}

function canonicalizeIngredientIdForImpact(rawId) {
  if (!rawId) return null;

  const canonical = resolveCanonicalIngredientForImpact(rawId);
  if (!canonical) return null;

  const c = cleanName(canonical || "");
  if (!c) return null;

  if (
    c === "corn" ||
    c === "corn grain" ||
    c === "corn grain avg" ||
    c === "corn grain average" ||
    c === "corn_grain_avg" ||
    c === "maize"
  ) return "corn_family";

  if (
    c === "soybean_meal" ||
    c === "soybean_meal_46_5_cp" ||
    c === "soybean_meal_48_cp" ||
    c === "soybean meal" ||
    c === "sbm48" ||
    c === "sbm46" ||
    c.includes("soybean meal")
  ) return "soybean_meal_family";

  if (
    c === "oil" ||
    c === "vegetable_oil" ||
    c === "vegetable oil" ||
    c === "soybean_oil" ||
    c === "soybean oil" ||
    c === "soyabean oil" ||
    c === "soya oil"
  ) return "oil_family";

  if (c === "limestone" || c === "calcium_carbonate" || c === "calcium carbonate") return "limestone_family";
  if (c === "dcp" || c === "dicalcium_phosphate" || c === "dicalcium phosphate") return "dcp_family";
  if (c === "salt" || c === "sodium_chloride" || c === "sodium chloride") return "salt_family";
  if (c === "dlm" || c === "dl_met" || c === "dl met" || c === "dl methionine" || c === "dl-methionine") return "dl_met_family";
  if (c === "l_lys_hcl" || c === "l lys hcl" || c === "lysine hcl" || c === "l-lysine hcl") return "l_lys_hcl_family";
  if (c === "l_thr" || c === "thr" || c === "threonine") return "l_thr_family";
  if (c === "wheat" || c === "wheat grain" || c === "wheat_grain") return "wheat_family";
  if (c === "wheat bran" || c === "wheat_bran" || c === "bran" || c === "pollard") return "wheat_bran_family";
  if (c === "wheat midds" || c === "wheat middlings" || c === "wheat_midds") return "wheat_midds_family";
  if (c === "rice broken" || c === "broken rice" || c === "rice_broken") return "rice_broken_family";
  if (c === "rice polish" || c === "rice polishings" || c === "rice_polish") return "rice_polish_family";
  if (c === "meat meal" || c === "meat_meal") return "meat_meal_family";
  if (c === "mbm" || c === "meat bone meal" || c === "meat and bone meal" || c === "meat_bone_meal") return "mbm_family";
  if (c === "poultry by-product meal" || c === "poultry by product meal" || c === "poultry_byproduct_meal" || c === "pbm") return "poultry_byproduct_family";
  if (c === "ddgs" || c === "corn ddgs") return "ddgs_family";
  if (c === "canola meal" || c === "rapeseed meal" || c === "canola_meal" || c === "rapeseed_meal") return "canola_meal_family";
  if (c === "sunflower meal" || c === "sunflower_meal") return "sunflower_meal_family";
  if (c === "fish meal" || c === "fish_meal") return "fish_meal_family";
  if (c === "cg" || c === "c g" || c === "corn gluten" || c === "corn gluten meal" || c === "corn_gluten") return "corn_gluten_family";
  if (c === "enzyme_products" || c === "enzyme" || c === "enzymes" || c === "phytase" || c === "protease" || c === "xylanase") return "enzyme_family";
  if (c === "toxin_binders" || c === "toxin binder" || c === "toxin binders" || c === "mycotoxin binder" || c === "toxin_binder") return "toxin_binder_family";
  if (c === "premix" || c === "premixes" || c === "vitamin premix" || c === "mineral premix" || c === "vitamin_premix" || c === "mineral_premix") return "premix_family";

  return c;
}

function ingredientMatchesForImpact(leftId, rightId, familyMap = null) {
  const left = canonicalizeIngredientIdForImpact(leftId);
  const right = canonicalizeIngredientIdForImpact(rightId);

  if (!left || !right) return false;
  if (left === right) return true;

  const map = familyMap || loadIngredientFamilies();

  for (const [familyKey, members] of Object.entries(map || {})) {
    if (!Array.isArray(members)) continue;

    const normalizedMembers = members
      .map((x) => canonicalizeIngredientIdForImpact(x))
      .filter(Boolean);

    const normalizedFamilyKey = canonicalizeIngredientIdForImpact(familyKey) || familyKey;

    if (normalizedMembers.includes(left) && normalizedMembers.includes(right)) return true;
    if (normalizedFamilyKey === left && normalizedMembers.includes(right)) return true;
    if (normalizedFamilyKey === right && normalizedMembers.includes(left)) return true;
  }

  return false;
}

function formulaContainsIngredient(formula, targetIngredientId) {
  const familyMap = loadIngredientFamilies();
  const ingredients = Array.isArray(formula?.ingredients) ? formula.ingredients : [];

  return ingredients.some((ing) => {
    const ingId = String(ing?.ingredient_id || "").trim();
    const ingDisplay = String(ing?.display_name || "").trim();

    return (
      ingredientMatchesForImpact(ingId, targetIngredientId, familyMap) ||
      ingredientMatchesForImpact(ingDisplay, targetIngredientId, familyMap)
    );
  });
}

function getFormulaIngredientInclusion(formula, targetIngredientId) {
  const familyMap = loadIngredientFamilies();
  const ingredients = Array.isArray(formula?.ingredients) ? formula.ingredients : [];

  for (const ing of ingredients) {
    const ingId = String(ing?.ingredient_id || "").trim();
    const ingDisplay = String(ing?.display_name || "").trim();

    if (
      ingredientMatchesForImpact(ingId, targetIngredientId, familyMap) ||
      ingredientMatchesForImpact(ingDisplay, targetIngredientId, familyMap)
    ) {
      return toNum(ing?.inclusion);
    }
  }

  return null;
}

function estimateFormulaNutrientValueFromConstraints(formula, key) {
  const normalizedKey = String(key || "").trim();

  const directProfile =
    formula?.nutrient_profile_full ||
    formula?.nutrient_profile ||
    formula?.calculated_nutrients ||
    null;

  if (directProfile && typeof directProfile === "object") {
    const direct = toNum(directProfile[normalizedKey]);
    if (direct != null) return direct;

    if (normalizedKey === "me") {
      const meKcal = toNum(directProfile.me_kcal);
      if (meKcal != null) return meKcal;
    }

    if (normalizedKey === "me_kcal") {
      const me = toNum(directProfile.me);
      if (me != null) return me;
    }
  }

  const rows = Array.isArray(formula?.nutrient_constraints) ? formula.nutrient_constraints : [];
  const row = rows.find((x) => String(x?.key || "").trim() === normalizedKey);
  if (!row) return null;

  if (toNum(row.target) != null) return toNum(row.target);
  if (toNum(row.min) != null && toNum(row.max) != null) {
    return Number(((toNum(row.min) + toNum(row.max)) / 2).toFixed(4));
  }
  if (toNum(row.min) != null) return toNum(row.min);
  if (toNum(row.max) != null) return toNum(row.max);
  return null;
}

function estimateFormulaImpactRows(formula, diffRows, inclusionPct) {
  const keysToShow = [
    "dm", "cp", "me", "ca", "avp", "na",
    "sid_lys", "sid_met", "sid_metcys"
  ];

  const inclusionFactor = (toNum(inclusionPct) || 0) / 100;

  return keysToShow.map((key) => {
    const diff =
      diffRows.find((x) => x.nutrient === key) ||
      (key === "me"
        ? diffRows.find((x) => x.nutrient === "me_kcal")
        : key === "me_kcal"
        ? diffRows.find((x) => x.nutrient === "me")
        : null);

    const ingredientDelta = diff?.delta != null ? toNum(diff.delta) : 0;
    const estimatedChange = Number((ingredientDelta * inclusionFactor).toFixed(4));

    const oldVal = estimateFormulaNutrientValueFromConstraints(formula, key);
    const newVal = oldVal != null ? Number((oldVal + estimatedChange).toFixed(4)) : null;
    const change =
      oldVal != null && newVal != null
        ? Number((newVal - oldVal).toFixed(4))
        : null;

    return {
      nutrient: key,
      unit:
        key === "me" ? "kcal/kg" :
        ["dm", "cp", "ca", "avp", "na", "sid_lys", "sid_met", "sid_metcys"].includes(key) ? "%" :
        "",
      old: oldVal,
      new: newVal,
      change
    };
  });
}

function classifyFormulaImpact(rows = []) {
  const materialThresholds = {
    dm: 0.5,
    cp: 0.1,
    me: 15,
    ca: 0.02,
    avp: 0.01,
    na: 0.01,
    sid_lys: 0.01,
    sid_met: 0.005,
    sid_metcys: 0.01
  };

  let hasRisk = false;
  let hasImproved = false;

  for (const row of rows || []) {
    const nutrient = String(row?.nutrient || "").trim();
    const change = toNum(row?.change);
    if (change == null) continue;

    const th = materialThresholds[nutrient] ?? 0;

    if (change <= -th) hasRisk = true;
    if (change >= th) hasImproved = true;
  }

  if (hasRisk) return "Risk";
  if (hasImproved) return "Improved";
  return "OK";
}

function buildFormulaImpactSummary(items = []) {
  const formulas_checked = Array.isArray(items) ? items.length : 0;
  const improved_count = items.filter((x) => x.status === "Improved").length;
  const ok_count = items.filter((x) => x.status === "OK").length;
  const risk_count = items.filter((x) => x.status === "Risk").length;

  return {
    formulas_checked,
    improved_count,
    ok_count,
    risk_count,
  };
}

function loadImpactFormulasV1() {
  const setFile = getBroilerStarterFormulaSetFile();
  const setJson = readJsonFileSafe(setFile, { items: [] });
  const items = Array.isArray(setJson?.items) ? setJson.items : [];

  const out = [];

  for (const item of items) {
    const formulaId = String(item?.formula_id || "").trim();
    if (!formulaId) continue;

    const formulaFile = getFormulaFileById(formulaId);
    const formula = readFormulaJson(formulaFile);
    const fallbackText = String(item?.formula_text || "").trim();

    if (formula && Array.isArray(formula.ingredients) && formula.ingredients.length > 0) {
      out.push({
        ...formula,
        formula_id: formula.formula_id || formulaId,
        formula_name: formula.formula_name || item?.formula_name || formulaId,
        formula_text: fallbackText || formula.formula_text || null,
      });
      continue;
    }

    const parsedIngredients = fallbackText ? parseFormulaTextToIngredients(fallbackText) : [];

    out.push({
      formula_id: formulaId,
      formula_name: item?.formula_name || formulaId,
      formula_text: fallbackText || null,
      ingredients: parsedIngredients,
      nutrient_constraints: Array.isArray(formula?.nutrient_constraints) ? formula.nutrient_constraints : [],
      nutrient_profile_full: formula?.nutrient_profile_full || null,
      nutrient_profile: formula?.nutrient_profile || null,
      calculated_nutrients: formula?.calculated_nutrients || null,
      species: formula?.species || null,
      type: formula?.type || null,
      production: formula?.production || null,
      breed: formula?.breed || null,
      phase: formula?.phase || null,
    });
  }

  return out;
}

function getQcComparableIngredientKeys(sample = {}, ingredient_id = "") {
  const keys = new Set();

  const addKey = (v) => {
    const s = String(v || "").trim();
    if (!s) return;
    keys.add(s);
    const family = canonicalizeIngredientIdForImpact(s);
    if (family) keys.add(family);
  };

  addKey(ingredient_id);
  addKey(sample?.ingredient_id);
  addKey(sample?.matched_ingredient_id);
  addKey(sample?.entered_name);
  addKey(sample?.matched_display_name);
  addKey(sample?.ingredient_name);

  return Array.from(keys);
}

function isQcReferenceLike(sample = {}) {
  const decision = String(sample?.decision_status || "").trim().toLowerCase();
  const status = String(sample?.status || "").trim().toLowerCase();

  return (
    decision === "approved_update" ||
    decision === "temporary_override" ||
    status === "approved_update" ||
    status === "override_active" ||
    status === "approved_override"
  );
}

function getLatestComparableQcReferenceSample(currentSample = {}, ingredient_id = "") {
  const store = getQcStore();
  const currentId = String(currentSample?.sample_id || "").trim();
  const currentKeys = new Set(getQcComparableIngredientKeys(currentSample, ingredient_id));

  const candidates = (store.samples || [])
    .filter((s) => String(s?.sample_id || "").trim() !== currentId)
    .filter((s) => isQcReferenceLike(s))
    .filter((s) => {
      const keys = getQcComparableIngredientKeys(s, ingredient_id);
      return keys.some((k) => currentKeys.has(k));
    })
    .sort((a, b) =>
      String(b?.updated_at || b?.reviewed_at || b?.created_at || "").localeCompare(
        String(a?.updated_at || a?.reviewed_at || a?.created_at || "")
      )
    );

  return candidates[0] || null;
}

function resolveQcComparisonBaseline(sample = {}, row = null, ingredient_id = "") {
  const sampleBaseline = normalizeQcNutrients(sample?.baseline_nutrients || sample?.baseline || {});
  const referenceSample = getLatestComparableQcReferenceSample(sample, ingredient_id);

  const referenceProfile = normalizeQcNutrients(
    referenceSample?.approved_profile ||
    referenceSample?.override_payload ||
    referenceSample?.reported_nutrients ||
    referenceSample?.nutrients ||
    referenceSample?.baseline_nutrients ||
    {}
  );

  const dbBaseline = row ? toReviewNutrientProfile(row) : {};

  const baseline_profile =
    Object.keys(referenceProfile || {}).length > 0
      ? referenceProfile
      : Object.keys(sampleBaseline || {}).length > 0
      ? sampleBaseline
      : dbBaseline;

  return {
    baseline_profile,
    baseline_source:
      Object.keys(referenceProfile || {}).length > 0
        ? "latest_reference_sample"
        : Object.keys(sampleBaseline || {}).length > 0
        ? "sample_baseline"
        : "ingredient_db",
    reference_sample_id: referenceSample?.sample_id || null,
  };
}


router.get("/v1/qc/ingredient-profile/:id", async (req, res) => {
  try {
    const ingredient_id = String(req.params.id || "").trim();

    if (!ingredient_id) {
      return res.status(400).json({
        ok: false,
        error: "QC_INGREDIENT_ID_REQUIRED",
        message: "ingredient id is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const db = loadIngredientMasterDb();
    const row = db[ingredient_id];

    if (!row || typeof row !== "object") {
      return res.status(404).json({
        ok: false,
        error: "QC_INGREDIENT_NOT_FOUND",
        message: "Ingredient not found",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const nutrient_profile = toReviewNutrientProfile(row);

    return res.json({
      ok: true,
      ingredient_id,
      display_name: row.display_name || ingredient_id,
      nutrient_profile,
      meta: {
        route_version: INGEST_ROUTE_VERSION,
        source: "ingredient_db",
      },
    });
  } catch (e) {
    console.error("[QC_INGREDIENT_PROFILE] error", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "QC_INGREDIENT_PROFILE_FAILED",
      message: e?.message || "Failed to load ingredient profile",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.post("/v1/qc/review2/:sample_id/approve", async (req, res) => {
  try {
    const sample_id = String(req.params.sample_id || "").trim();
    const ingredient_id_body = String(req.body?.ingredient_id || "").trim();
    const approved_profile = req.body?.approved_profile || {};
    const approved_by = String(req.body?.approved_by || "nutritionist").trim();
    const reason = String(req.body?.reason || "QC approved override").trim();

    if (!sample_id) {
      return res.status(400).json({
        ok: false,
        error: "QC_SAMPLE_ID_REQUIRED",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    if (!approved_profile || typeof approved_profile !== "object") {
      return res.status(400).json({
        ok: false,
        error: "QC_APPROVED_PROFILE_REQUIRED",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const sampleFile = getQcSamplesFile();
    const auditFile = getQcAuditFile();

    const sampleStore = readJsonFileSafe(sampleFile, { samples: [] });
    if (!Array.isArray(sampleStore.samples)) sampleStore.samples = [];

    const idx = sampleStore.samples.findIndex(
      (x) => String(x?.sample_id || "").trim() === sample_id
    );

    if (idx < 0) {
      return res.status(404).json({
        ok: false,
        error: "QC_SAMPLE_NOT_FOUND",
        message: "QC sample not found",
        meta: {
          route_version: INGEST_ROUTE_VERSION,
          sample_file: sampleFile,
          samples_count: sampleStore.samples.length,
        },
      });
    }

    const sample = sampleStore.samples[idx];
    const ingredient_id =
      ingredient_id_body ||
      String(sample?.ingredient_id || sample?.matched_ingredient_id || "").trim();

    if (!ingredient_id) {
      return res.status(400).json({
        ok: false,
        error: "QC_INGREDIENT_ID_REQUIRED",
        message: "ingredient_id is required either in body or stored sample",
        meta: { route_version: INGEST_ROUTE_VERSION, sample_file: sampleFile },
      });
    }

    const db = loadIngredientMasterDb();
    const baseRow = db[ingredient_id];

    if (!baseRow || typeof baseRow !== "object") {
      return res.status(404).json({
        ok: false,
        error: "QC_INGREDIENT_NOT_FOUND",
        message: "Ingredient not found in master DB",
        meta: { route_version: INGEST_ROUTE_VERSION, ingredient_id },
      });
    }

    const baseline_profile = toReviewNutrientProfile(baseRow);
    const normalized_override = normalizeQcNutrients(approved_profile);

    const { file: overridesFile, store: overridesStore } = readOverridesStore();
    const previous_active = getActiveOverrideForIngredient(overridesStore, ingredient_id);

    deactivateActiveOverride(overridesStore, ingredient_id, "superseded_by_new_override");

    const override_id = `ovr_${ingredient_id}_${Date.now()}`;
    const effective_profile = buildEffectiveIngredientProfile(baseRow, normalized_override);

    const overrideRow = {
      override_id,
      ingredient_id,
      ingredient_name: baseRow.display_name || ingredient_id,
      sample_id,
      approved_by,
      approved_at: new Date().toISOString(),
      reason,
      active: true,
      status: "approved_override",
      override_profile: effective_profile,
      baseline_profile,
      previous_override_id: previous_active?.override_id || null,
    };

    overridesStore.overrides.push(overrideRow);
    writeOverridesStore(overridesStore);

    sample.status = "approved_override";
    sample.review_decision = "approved_override";
    sample.decision_status = "approved_update";
    sample.reviewed_at = overrideRow.approved_at;
    sample.reviewed_by = approved_by;
    sample.ingredient_id = ingredient_id;
    sample.matched_ingredient_id = ingredient_id;
    sample.baseline_nutrients = baseline_profile;
    sample.approved_profile = effective_profile;
    sample.override_payload = effective_profile;
    sample.override_id = override_id;

    writeJsonFilePretty(sampleFile, sampleStore);

    const auditStore = readJsonFileSafe(auditFile, { events: [] });
    if (!Array.isArray(auditStore.events)) auditStore.events = [];

    auditStore.events.push({
      event_type: "qc_override_approved",
      sample_id,
      ingredient_id,
      override_id,
      approved_at: overrideRow.approved_at,
      approved_by,
      baseline_profile,
      override_profile: effective_profile,
      effective_profile,
      overrides_file: overridesFile,
      route_version: INGEST_ROUTE_VERSION,
    });

    writeJsonFilePretty(auditFile, auditStore);

    return res.json({
      ok: true,
      message: "QC override approved. Base ingredient DB was not modified.",
      sample_id,
      ingredient_id,
      override_id,
      status: sample.status,
      baseline_profile,
      override_profile: effective_profile,
      effective_profile,
      qc_record: sample,
      meta: {
        route_version: INGEST_ROUTE_VERSION,
        sample_file: sampleFile,
        audit_file: auditFile,
        overrides_file: overridesFile,
        base_db_unchanged: true,
      },
    });
  } catch (e) {
    console.error("[QC APPROVE OVERRIDE ERROR]", e?.message || e);

    return res.status(500).json({
      ok: false,
      error: "QC_APPROVE_FAILED",
      message: e?.message || "Approval failed",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.post("/v1/qc/review/:sample_id/impact", async (req, res) => {
  try {
    const sample_id = String(req.params.sample_id || "").trim();
    const body = req.body || {};

    if (!sample_id) {
      return res.status(400).json({
        ok: false,
        error: "QC_SAMPLE_ID_REQUIRED",
        message: "sample_id is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const sampleFile = getQcSamplesFile();
    const sampleStore = readJsonFileSafe(sampleFile, { samples: [] });
    if (!Array.isArray(sampleStore.samples)) sampleStore.samples = [];

    const sample = sampleStore.samples.find(
      (x) => String(x?.sample_id || "").trim() === sample_id
    );

    if (!sample) {
      return res.status(404).json({
        ok: false,
        error: "QC_SAMPLE_NOT_FOUND",
        message: "QC sample not found",
        meta: {
          route_version: INGEST_ROUTE_VERSION,
          sample_file: sampleFile,
          samples_count: sampleStore.samples.length,
        },
      });
    }

    const ingredient_id_raw =
      String(body.ingredient_id || sample.ingredient_id || sample.matched_ingredient_id || "").trim();

    if (!ingredient_id_raw) {
      return res.status(400).json({
        ok: false,
        error: "QC_INGREDIENT_ID_REQUIRED",
        message: "ingredient_id is required either in body or stored sample",
        meta: { route_version: INGEST_ROUTE_VERSION, sample_file: sampleFile },
      });
    }

    const proposed_input =
      body.proposed_profile ||
      sample.approved_profile ||
      sample.override_payload ||
      sample.reported_nutrients ||
      sample.nutrients ||
      {};

    const resolved = resolveDbIngredientContext(ingredient_id_raw, proposed_input);
    const ingredient_id = resolved.ingredient_id;
    const row = resolved.row;

    if (!ingredient_id || !row || typeof row !== "object") {
      return res.status(404).json({
        ok: false,
        error: "QC_INGREDIENT_NOT_FOUND",
        message: "Ingredient not found in master DB",
        meta: { route_version: INGEST_ROUTE_VERSION, ingredient_id: ingredient_id_raw },
      });
    }

    const baselineResolved = resolveQcComparisonBaseline(sample, row, ingredient_id);
    const baseline_profile = baselineResolved.baseline_profile;
    const proposed_profile = buildImpactProfile(baseline_profile, proposed_input);
    const diff_rows = buildImpactDiffRows(baseline_profile, proposed_profile);
    const risk_summary = buildImpactRiskSummary(diff_rows);

    const formulas = loadImpactFormulasV1();
    const affected_formulas = [];

    for (const formula of formulas) {
      if (!formulaContainsIngredient(formula, ingredient_id)) continue;

      const inclusion = getFormulaIngredientInclusion(formula, ingredient_id);
      const nutrient_rows = estimateFormulaImpactRows(formula, diff_rows, inclusion);
      const status = classifyFormulaImpact(nutrient_rows);

      affected_formulas.push({
        formula_id: formula.formula_id,
        formula_name: formula.formula_name,
        species: formula.species,
        type: formula.type,
        production: formula.production,
        breed: formula.breed,
        phase: formula.phase,
        inclusion_pct: inclusion,
        status,
        nutrient_rows
      });
    }

    const summary = buildFormulaImpactSummary(affected_formulas);

    return res.json({
      ok: true,
      sample_id,
      ingredient_id,
      ingredient_name: row.display_name || sample.ingredient_name || ingredient_id,
      baseline_profile,
      proposed_profile,
      diff_rows,
      risk_summary,
      formulas_checked: summary.formulas_checked,
      improved_count: summary.improved_count,
      ok_count: summary.ok_count,
      risk_count: summary.risk_count,
      affected_formulas,
      meta: {
        route_version: INGEST_ROUTE_VERSION,
        sample_file: sampleFile,
        impact_scope: "formula_level_v3_hybrid_profile",
        formula_source: "data/formula_sets/broiler_starters.json",
        formulas_loaded: formulas.length,
        baseline_source: baselineResolved?.baseline_source || null,
        reference_sample_id: baselineResolved?.reference_sample_id || null,
        note: "Formula-level values use hybrid baseline extraction from formula nutrient profiles first, then nutrient constraints fallback, plus inclusion-based delta propagation",
      },
    });
  } catch (e) {
    console.error("[QC_IMPACT] error", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "QC_IMPACT_FAILED",
      message: e?.message || "QC impact analysis failed",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});
router.post("/v1/qc/override/:ingredient_id/rollback", async (req, res) => {
  try {
    const ingredient_id = String(req.params.ingredient_id || "").trim();
    const rolled_back_by = String(req.body?.rolled_back_by || "nutritionist").trim();
    const reason = String(req.body?.reason || "Manual rollback").trim();

    if (!ingredient_id) {
      return res.status(400).json({
        ok: false,
        error: "QC_INGREDIENT_ID_REQUIRED",
        message: "ingredient_id is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const { file: overridesFile, store: overridesStore } = readOverridesStore();
    const active = getActiveOverrideForIngredient(overridesStore, ingredient_id);

    if (!active) {
      return res.status(404).json({
        ok: false,
        error: "QC_ACTIVE_OVERRIDE_NOT_FOUND",
        message: "No active override found for this ingredient",
        meta: { route_version: INGEST_ROUTE_VERSION, overrides_file: overridesFile },
      });
    }

    active.active = false;
    active.status = "rolled_back";
    active.rolled_back_at = new Date().toISOString();
    active.rolled_back_by = rolled_back_by;
    active.rollback_reason = reason;

    writeOverridesStore(overridesStore);

    const auditFile = getQcAuditFile();
    const auditStore = readJsonFileSafe(auditFile, { events: [] });
    if (!Array.isArray(auditStore.events)) auditStore.events = [];

    auditStore.events.push({
      event_type: "qc_override_rolled_back",
      ingredient_id,
      override_id: active.override_id,
      rolled_back_at: active.rolled_back_at,
      rolled_back_by,
      reason,
      route_version: INGEST_ROUTE_VERSION,
    });

    writeJsonFilePretty(auditFile, auditStore);

    return res.json({
      ok: true,
      message: "Active override rolled back successfully",
      ingredient_id,
      override_id: active.override_id,
      status: active.status,
      active: active.active,
      meta: {
        route_version: INGEST_ROUTE_VERSION,
        overrides_file: overridesFile,
        audit_file: auditFile,
      },
    });
  } catch (e) {
    console.error("[QC_OVERRIDE_ROLLBACK] error", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "QC_OVERRIDE_ROLLBACK_FAILED",
      message: e?.message || "Rollback failed",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.post("/v1/qc/override/:ingredient_id/create-from-base", async (req, res) => {
  try {
    const ingredient_id = String(req.params.ingredient_id || "").trim();
    const created_by = String(req.body?.created_by || "nutritionist").trim();
    const reason = String(req.body?.reason || "Create override from base").trim();

    if (!ingredient_id) {
      return res.status(400).json({
        ok: false,
        error: "QC_INGREDIENT_ID_REQUIRED",
        message: "ingredient_id is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const db = loadIngredientMasterDb();
    const baseRow = db[ingredient_id];

    if (!baseRow || typeof baseRow !== "object") {
      return res.status(404).json({
        ok: false,
        error: "QC_INGREDIENT_NOT_FOUND",
        message: "Ingredient not found in base DB",
        meta: { route_version: INGEST_ROUTE_VERSION, ingredient_id },
      });
    }

    const { store } = readUsIngredientOverrideStore();

    const overrideRecord = buildFullOverrideRecord(baseRow, ingredient_id, {}, {
      created_by,
      reason,
      source: "base_copy"
    });

    store.ingredients[ingredient_id] = overrideRecord;
    const savedFile = writeUsIngredientOverrideStore(store);

    return res.json({
      ok: true,
      message: "Override created from base ingredient",
      ingredient_id,
      override_record: overrideRecord,
      meta: {
        route_version: INGEST_ROUTE_VERSION,
        override_file: savedFile,
      },
    });
  } catch (e) {
    console.error("[QC_OVERRIDE_CREATE_FROM_BASE]", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "QC_OVERRIDE_CREATE_FAILED",
      message: e?.message || "Failed to create override from base",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.get("/v1/qc/override/:ingredient_id", async (req, res) => {
  try {
    const ingredient_id = String(req.params.ingredient_id || "").trim();

    if (!ingredient_id) {
      return res.status(400).json({
        ok: false,
        error: "QC_INGREDIENT_ID_REQUIRED",
        message: "ingredient_id is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const { file, store } = readUsIngredientOverrideStore();
    const row = store.ingredients?.[ingredient_id];

    if (!row || typeof row !== "object") {
      return res.status(404).json({
        ok: false,
        error: "QC_OVERRIDE_NOT_FOUND",
        message: "Override not found",
        meta: {
          route_version: INGEST_ROUTE_VERSION,
          override_file: file,
          ingredient_id
        },
      });
    }

    return res.json({
      ok: true,
      ingredient_id,
      override_record: row,
      meta: {
        route_version: INGEST_ROUTE_VERSION,
        override_file: file,
      },
    });
  } catch (e) {
    console.error("[QC_OVERRIDE_GET]", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "QC_OVERRIDE_GET_FAILED",
      message: e?.message || "Failed to load override",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.post("/v1/qc/override/:ingredient_id/save", async (req, res) => {
  try {
    const ingredient_id = String(req.params.ingredient_id || "").trim();
    const override_profile = req.body?.override_profile || {};
    const updated_by = String(req.body?.updated_by || "nutritionist").trim();
    const reason = String(req.body?.reason || "Manual override update").trim();

    if (!ingredient_id) {
      return res.status(400).json({
        ok: false,
        error: "QC_INGREDIENT_ID_REQUIRED",
        message: "ingredient_id is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    if (!override_profile || typeof override_profile !== "object") {
      return res.status(400).json({
        ok: false,
        error: "QC_OVERRIDE_PROFILE_REQUIRED",
        message: "override_profile is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const db = loadIngredientMasterDb();
    const baseRow = db[ingredient_id];

    if (!baseRow || typeof baseRow !== "object") {
      return res.status(404).json({
        ok: false,
        error: "QC_INGREDIENT_NOT_FOUND",
        message: "Ingredient not found in base DB",
        meta: { route_version: INGEST_ROUTE_VERSION, ingredient_id },
      });
    }

    const { store } = readUsIngredientOverrideStore();
    const existing = store.ingredients?.[ingredient_id] || {};

    const overrideRecord = buildFullOverrideRecord(baseRow, ingredient_id, override_profile, {
      created_by: existing?._override_meta?.created_by || updated_by,
      created_at: existing?._override_meta?.created_at || new Date().toISOString(),
      updated_by,
      reason,
      source: "manual_override_save"
    });

    store.ingredients[ingredient_id] = overrideRecord;
    const savedFile = writeUsIngredientOverrideStore(store);

    return res.json({
      ok: true,
      message: "Override saved successfully",
      ingredient_id,
      override_record: overrideRecord,
      meta: {
        route_version: INGEST_ROUTE_VERSION,
        override_file: savedFile,
      },
    });
  } catch (e) {
    console.error("[QC_OVERRIDE_SAVE]", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "QC_OVERRIDE_SAVE_FAILED",
      message: e?.message || "Failed to save override",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.post("/v1/qc/override/:ingredient_id/remove", async (req, res) => {
  try {
    const ingredient_id = String(req.params.ingredient_id || "").trim();
    const removed_by = String(req.body?.removed_by || "nutritionist").trim();
    const reason = String(req.body?.reason || "Revert to base").trim();

    if (!ingredient_id) {
      return res.status(400).json({
        ok: false,
        error: "QC_INGREDIENT_ID_REQUIRED",
        message: "ingredient_id is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const { file, store } = readUsIngredientOverrideStore();
    const existing = store.ingredients?.[ingredient_id];

    if (!existing || typeof existing !== "object") {
      return res.status(404).json({
        ok: false,
        error: "QC_OVERRIDE_NOT_FOUND",
        message: "Override not found",
        meta: {
          route_version: INGEST_ROUTE_VERSION,
          override_file: file,
          ingredient_id
        },
      });
    }

    delete store.ingredients[ingredient_id];
    const savedFile = writeUsIngredientOverrideStore(store);

    const auditFile = getQcAuditFile();
    const auditStore = readJsonFileSafe(auditFile, { events: [] });
    if (!Array.isArray(auditStore.events)) auditStore.events = [];

    auditStore.events.push({
      event_type: "qc_override_removed",
      ingredient_id,
      removed_by,
      removed_at: new Date().toISOString(),
      reason,
      route_version: INGEST_ROUTE_VERSION,
    });

    writeJsonFilePretty(auditFile, auditStore);

    return res.json({
      ok: true,
      message: "Override removed. System will now use base DB for this ingredient.",
      ingredient_id,
      meta: {
        route_version: INGEST_ROUTE_VERSION,
        override_file: savedFile,
        audit_file: auditFile,
      },
    });
  } catch (e) {
    console.error("[QC_OVERRIDE_REMOVE]", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "QC_OVERRIDE_REMOVE_FAILED",
      message: e?.message || "Failed to remove override",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.get("/v1/qc/samples", async (_req, res) => {
  try {
    const store = getQcStore();
    const samples = [...store.samples].sort((a, b) =>
      String(b?.updated_at || "").localeCompare(String(a?.updated_at || ""))
    );
    return res.json({
      ok: true,
      samples,
      meta: { route_version: INGEST_ROUTE_VERSION, count: samples.length },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "QC_SAMPLES_LIST_FAILED",
      message: e?.message || "Failed to read QC samples",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.get("/v1/qc/samples/:sample_id", async (req, res) => {
  try {
    const qc_record = getQcSampleById(req.params.sample_id);
    if (!qc_record) {
      return res.status(404).json({
        ok: false,
        error: "QC_SAMPLE_NOT_FOUND",
        message: "QC sample not found",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    return res.json({
      ok: true,
      qc_record,
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "QC_SAMPLE_READ_FAILED",
      message: e?.message || "Failed to read QC sample",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.post("/v1/qc/decision/:sample_id/rescreen", async (req, res) => {
  try {
    const existing = getQcSampleById(req.params.sample_id);
    if (!existing) {
      return res.status(404).json({
        ok: false,
        error: "QC_SAMPLE_NOT_FOUND",
        message: "QC sample not found",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const qc_record = qcEvaluateRecord(existing);
    const persisted = saveQcRecord(qc_record);

    return res.json({
      ok: true,
      qc_record,
      meta: {
        route_version: INGEST_ROUTE_VERSION,
        sample_file: persisted.sampleFile,
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "QC_RESCREEN_FAILED",
      message: e?.message || "Failed to rescreen QC sample",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.post("/v1/qc/decision/:sample_id/approve", async (req, res) => {
  try {
    const body = req.body || {};
    const existing = getQcSampleById(req.params.sample_id);

    if (!existing) {
      return res.status(404).json({
        ok: false,
        error: "QC_SAMPLE_NOT_FOUND",
        message: "QC sample not found",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const ingredient_id = String(
      existing.ingredient_id || existing.matched_ingredient_id || body.ingredient_id || ""
    ).trim();

    const db = loadIngredientMasterDb();
    const row = ingredient_id ? db[ingredient_id] : null;
    const baseline_profile = row && typeof row === "object" ? toReviewNutrientProfile(row) : {};

    const proposed_input =
      body.override_payload ||
      body.override_profile ||
      existing.approved_profile ||
      existing.override_payload ||
      existing.reported_nutrients ||
      existing.nutrients ||
      {};

    const effective_profile = buildImpactProfile(baseline_profile, proposed_input);

    const out = updateQcDecision(req.params.sample_id, {
      decision_status: "approved_update",
      status: "approved_update",
      reviewed_by: String(body.reviewed_by || "nutritionist").trim(),
      reviewed_at: new Date().toISOString(),
      review_note: String(body.review_note || "").trim(),
      baseline_nutrients: baseline_profile,
      approved_profile: effective_profile,
      override_payload: effective_profile,
    });

    return res.json({
      ok: true,
      qc_record: out.qc_record,
      approved_profile: effective_profile,
      ingredient_id,
      meta: { route_version: INGEST_ROUTE_VERSION, sample_file: out.persisted.sampleFile },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "QC_APPROVE_FAILED",
      message: e?.message || "Failed to approve QC sample",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.post("/v1/qc/decision/:sample_id/reject", async (req, res) => {
  try {
    const body = req.body || {};
    const out = updateQcDecision(req.params.sample_id, {
      decision_status: "rejected",
      status: "rejected",
      reviewed_by: String(body.reviewed_by || "nutritionist").trim(),
      reviewed_at: new Date().toISOString(),
      review_note: String(body.review_note || "").trim(),
      override_payload: null,
    });

    if (!out) {
      return res.status(404).json({
        ok: false,
        error: "QC_SAMPLE_NOT_FOUND",
        message: "QC sample not found",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    return res.json({
      ok: true,
      qc_record: out.qc_record,
      meta: { route_version: INGEST_ROUTE_VERSION, sample_file: out.persisted.sampleFile },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "QC_REJECT_FAILED",
      message: e?.message || "Failed to reject QC sample",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.post("/v1/qc/decision/:sample_id/record-only", async (req, res) => {
  try {
    const body = req.body || {};
    const out = updateQcDecision(req.params.sample_id, {
      decision_status: "record_only",
      status: "record_only",
      reviewed_by: String(body.reviewed_by || "nutritionist").trim(),
      reviewed_at: new Date().toISOString(),
      review_note: String(body.review_note || "").trim(),
      override_payload: null,
    });

    if (!out) {
      return res.status(404).json({
        ok: false,
        error: "QC_SAMPLE_NOT_FOUND",
        message: "QC sample not found",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    return res.json({
      ok: true,
      qc_record: out.qc_record,
      meta: { route_version: INGEST_ROUTE_VERSION, sample_file: out.persisted.sampleFile },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "QC_RECORD_ONLY_FAILED",
      message: e?.message || "Failed to mark QC sample record-only",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.post("/v1/qc/decision/:sample_id/temporary-override", async (req, res) => {
  try {
    const body = req.body || {};
    const existing = getQcSampleById(req.params.sample_id);

    if (!existing) {
      return res.status(404).json({
        ok: false,
        error: "QC_SAMPLE_NOT_FOUND",
        message: "QC sample not found",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const ingredient_id = String(
      existing.ingredient_id || existing.matched_ingredient_id || body.ingredient_id || ""
    ).trim();

    const db = loadIngredientMasterDb();
    const row = ingredient_id ? db[ingredient_id] : null;
    const baseline_profile = row && typeof row === "object" ? toReviewNutrientProfile(row) : {};

    const proposed_input =
      body.override_payload ||
      body.override_profile ||
      existing.approved_profile ||
      existing.override_payload ||
      existing.reported_nutrients ||
      existing.nutrients ||
      {};

    const effective_profile = buildImpactProfile(baseline_profile, proposed_input);

    const out = updateQcDecision(req.params.sample_id, {
      decision_status: "temporary_override",
      status: "override_active",
      reviewed_by: String(body.reviewed_by || "nutritionist").trim(),
      reviewed_at: new Date().toISOString(),
      review_note: String(body.review_note || "").trim(),
      baseline_nutrients: baseline_profile,
      override_payload: effective_profile,
      approved_profile: effective_profile,
    });

    return res.json({
      ok: true,
      qc_record: out.qc_record,
      meta: { route_version: INGEST_ROUTE_VERSION, sample_file: out.persisted.sampleFile },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "QC_TEMP_OVERRIDE_FAILED",
      message: e?.message || "Failed to apply temporary override",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

router.post("/v1/qc/impact/:sample_id/send-to-optimizer", async (req, res) => {
  try {
    const sample_id = String(req.params.sample_id || "").trim();
    if (!sample_id) {
      return res.status(400).json({
        ok: false,
        error: "QC_SAMPLE_ID_REQUIRED",
        message: "sample_id is required",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const sampleFile = getQcSamplesFile();
    const sampleStore = readJsonFileSafe(sampleFile, { samples: [] });
    if (!Array.isArray(sampleStore.samples)) sampleStore.samples = [];

    const sample = sampleStore.samples.find(
      (x) => String(x?.sample_id || "").trim() === sample_id
    );

    if (!sample) {
      return res.status(404).json({
        ok: false,
        error: "QC_SAMPLE_NOT_FOUND",
        message: "QC sample not found",
        meta: {
          route_version: INGEST_ROUTE_VERSION,
          sample_file: sampleFile,
          samples_count: sampleStore.samples.length,
        },
      });
    }

    const ingredient_id_raw = String(
      req.body?.ingredient_id || sample.ingredient_id || sample.matched_ingredient_id || ""
    ).trim();

    if (!ingredient_id_raw) {
      return res.status(400).json({
        ok: false,
        error: "QC_INGREDIENT_ID_REQUIRED",
        message: "ingredient_id is required either in body or stored sample",
        meta: { route_version: INGEST_ROUTE_VERSION, sample_file: sampleFile },
      });
    }

    const proposed_input =
      req.body?.proposed_profile ||
      sample.approved_profile ||
      sample.override_payload ||
      sample.reported_nutrients ||
      sample.nutrients ||
      {};

    const resolved = resolveDbIngredientContext(ingredient_id_raw, proposed_input);
    const ingredient_id = resolved.ingredient_id;
    const row = resolved.row;

    if (!ingredient_id || !row || typeof row !== "object") {
      return res.status(404).json({
        ok: false,
        error: "QC_INGREDIENT_NOT_FOUND",
        message: "Ingredient not found in master DB",
        meta: {
          route_version: INGEST_ROUTE_VERSION,
          ingredient_id: ingredient_id_raw,
        },
      });
    }

    const baselineResolved = resolveQcComparisonBaseline(sample, row, ingredient_id);
    const baseline_profile = baselineResolved.baseline_profile;
    const proposed_profile = buildImpactProfile(baseline_profile, proposed_input);
    const diff_rows = buildImpactDiffRows(baseline_profile, proposed_profile);

    function getConstraintRow(formula, nutrientKey) {
      const rows = Array.isArray(formula?.nutrient_constraints) ? formula.nutrient_constraints : [];
      return rows.find((x) => String(x?.key || "").trim() === String(nutrientKey || "").trim()) || null;
    }

    function summarizeFormulaConcern(nutrientRows, formula) {
      const primaryKeys = ["cp", "me", "sid_lys", "sid_met", "sid_metcys", "sid_thr", "sid_trp", "sid_arg"];
      const flagged = [];

      const attentionThresholds = {
        cp: 0.30,
        me: 25,
        sid_lys: 0.03,
        sid_met: 0.03,
        sid_metcys: 0.03,
        sid_thr: 0.03,
        sid_trp: 0.03,
        sid_arg: 0.03,
      };

      const reformulationThresholds = {
        cp: 0.50,
        me: 50,
        sid_lys: 0.05,
        sid_met: 0.05,
        sid_metcys: 0.05,
        sid_thr: 0.05,
        sid_trp: 0.05,
        sid_arg: 0.05,
      };

      for (const key of primaryKeys) {
        const row = (nutrientRows || []).find((x) => String(x?.nutrient || "").trim() === key);
        if (!row) continue;

        const oldVal = toNum(row.old);
        const newVal = toNum(row.new);
        const change = toNum(row.change);
        const drop = change != null ? Math.abs(Math.min(change, 0)) : 0;

        const constraint = getConstraintRow(formula, key);
        const minVal = toNum(constraint?.min);
        const targetVal = toNum(constraint?.target);

        let severity = null;
        let note = null;

        if (newVal != null && minVal != null && newVal < minVal) {
          severity = "potential_deficiency";
          note = `${key} estimated below minimum`;
        } else if (drop >= (reformulationThresholds[key] ?? Number.POSITIVE_INFINITY)) {
          severity = "potential_deficiency";
          note = `${key} reduction is material`;
        } else if (newVal != null && targetVal != null && newVal < targetVal) {
          severity = "below_target";
          note = `${key} estimated below target`;
        } else if (drop >= (attentionThresholds[key] ?? Number.POSITIVE_INFINITY)) {
          severity = "negative_shift";
          note = `${key} reduction should be reviewed`;
        }

        if (severity) {
          flagged.push({
            nutrient: key,
            old: oldVal,
            new: newVal,
            change,
            min: minVal,
            target: targetVal,
            severity,
            note,
          });
        }
      }

      let formula_status = "OK";

      if (flagged.some((x) => x.severity === "potential_deficiency")) {
        formula_status = "Potential Deficiency";
      } else if (flagged.some((x) => x.severity === "below_target" || x.severity === "negative_shift")) {
        formula_status = "Watch";
      }

      const summary_line =
        formula_status === "Potential Deficiency"
          ? "Material nutrient reduction detected. Reformulation review is recommended."
          : formula_status === "Watch"
          ? "A measurable nutrient reduction was detected. Reformulation is not automatically recommended, but nutrition review may be appropriate."
          : "No meaningful nutritional concern detected.";

      return {
        formula_status,
        summary_line,
        flagged_nutrients: flagged,
      };
    }

    function remapIngredientToFormulaContext(rawIngredientId, formulas) {
      const candidate = String(rawIngredientId || "").trim();
      if (!candidate) return candidate;

      const list = Array.isArray(formulas) ? formulas : [];
      const formulaIngredientIds = new Set();

      for (const formula of list) {
        const ingredients = Array.isArray(formula?.ingredients) ? formula.ingredients : [];
        for (const ing of ingredients) {
          const id = String(ing?.id || "").trim();
          if (id) formulaIngredientIds.add(id);
        }
      }

      if (formulaIngredientIds.has(candidate)) {
        return candidate;
      }

      const normalized = candidate.toLowerCase();

      const familyMatchers = [
        {
          keys: ["sbm", "soybean_meal", "soybean meal", "soya", "soy"],
          pick: (id) => /^soybean_meal_/i.test(id),
        },
        {
          keys: ["corn", "maize"],
          pick: (id) => /^corn($|_)/i.test(id) || /^maize($|_)/i.test(id),
        },
        {
          keys: ["dcp", "dicalcium_phosphate", "dicalcium phosphate"],
          pick: (id) => /^dcp$/i.test(id) || /^dicalcium_phosphate$/i.test(id),
        },
        {
          keys: ["salt", "sodium_chloride"],
          pick: (id) => /^salt$/i.test(id) || /^sodium_chloride$/i.test(id),
        },
        {
          keys: ["oil", "vegetable_oil", "vegetable oil"],
          pick: (id) => /^oil$/i.test(id) || /^vegetable_oil$/i.test(id),
        },
        {
          keys: ["lys", "lysine", "l_lys_hcl", "l-lysine hcl"],
          pick: (id) => /^l_lys_hcl$/i.test(id),
        },
        {
          keys: ["met", "methionine", "dl_met", "dl-methionine"],
          pick: (id) => /^dl_met$/i.test(id),
        },
      ];

      for (const rule of familyMatchers) {
        if (!rule.keys.some((k) => normalized.includes(k))) continue;

        const matches = [...formulaIngredientIds].filter(rule.pick);
        if (matches.length === 1) return matches[0];

        const exact48 = matches.find((x) => /48/i.test(x));
        if (exact48) return exact48;

        if (matches.length > 0) return matches[0];
      }

      return candidate;
    }

    const formulas = loadImpactFormulasV1();
    const impact_ingredient_id = remapIngredientToFormulaContext(ingredient_id, formulas);
    const affected_formulas = [];

    for (const formula of formulas) {
      if (!formulaContainsIngredient(formula, impact_ingredient_id)) continue;

      const inclusion = getFormulaIngredientInclusion(formula, impact_ingredient_id);
      const nutrient_rows = estimateFormulaImpactRows(formula, diff_rows, inclusion);
      const concern = summarizeFormulaConcern(nutrient_rows, formula);

      affected_formulas.push({
        formula_id: formula.formula_id,
        formula_name: formula.formula_name,
        species: formula.species,
        type: formula.type,
        production: formula.production,
        breed: formula.breed,
        phase: formula.phase,
        inclusion_pct: inclusion,
        status: concern.formula_status,
        summary_line: concern.summary_line,
        flagged_nutrients: concern.flagged_nutrients,
        nutrient_rows,
      });
    }

    const summary = {
      formulas_checked: affected_formulas.length,
      ok_count: affected_formulas.filter((x) => x.status === "OK").length,
      watch_count: affected_formulas.filter((x) => x.status === "Watch").length,
      potential_deficiency_count: affected_formulas.filter((x) => x.status === "Potential Deficiency").length,
    };

    return res.json({
      ok: true,
      message: "QC impact reviewed. Optimizer was not run automatically.",
      sample_id,
      ingredient_id: impact_ingredient_id,
      ingredient_name: row.display_name || sample.ingredient_name || impact_ingredient_id,
      baseline_profile,
      proposed_profile,
      diff_rows,
      decision: {
        auto_send_to_optimizer: false,
        manual_nutritionist_decision_required: true,
        recommendation:
          summary.potential_deficiency_count > 0
            ? "Material nutrient reduction was detected in one or more formulas. Reformulation review is recommended."
            : summary.watch_count > 0
            ? "A measurable nutrient reduction was detected in one or more formulas. Review before deciding whether reformulation is needed."
            : "No meaningful nutritional concern was detected. Reformulation is optional.",
      },
      summary,
      affected_formulas,
      optimizer_results: [],
      meta: {
        route_version: INGEST_ROUTE_VERSION,
        formula_source: "data/formula_sets/broiler_starters.json",
        formulas_loaded: formulas.length,
        baseline_source: baselineResolved?.baseline_source || null,
        reference_sample_id: baselineResolved?.reference_sample_id || null,
        requested_ingredient_id: ingredient_id,
        impact_ingredient_id,
        mode: "manual_decision_only",
        note: "This route never auto-runs optimizer. It only flags estimated nutrient concern and returns a review summary for nutritionist decision.",
      },
    });
  } catch (e) {
    console.error("[QC_SEND_TO_OPTIMIZER] error", e?.message || e);
    return res.status(500).json({
      ok: false,
      error: "QC_SEND_TO_OPTIMIZER_FAILED",
      message: e?.message || "Failed to review QC impact for optimizer decision",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

export default router;

