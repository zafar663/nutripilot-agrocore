import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { requireModule } from '../middleware/requireModule.js';
import { getNutrixDb } from '../../../core/db/nutrix/nutrix.db.js';

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

/** Evaluate enzyme dose-response at dose x. Supports breakpoints, mm, and exponential models. */
function evaluateEnzymeCurve(model_type, breakpoints, model_params, x) {
  const mt = (model_type || 'breakpoints').toLowerCase();
  const mp = (typeof model_params === 'string' ? JSON.parse(model_params || '{}') : model_params) || {};
  if (mt === 'mm') {
    const Rmax = Number(mp.Rmax || mp.rmax || 0);
    const Km   = Number(mp.Km   || mp.km   || 1);
    if (!Rmax || Km <= 0) return interpolateBreakpoints(breakpoints, x);
    return Math.round(Rmax * x / (Km + x) * 1e6) / 1e6;
  }
  if (mt === 'exponential') {
    const Rmax = Number(mp.Rmax || mp.rmax || 0);
    const k    = Number(mp.k || 1);
    if (!Rmax || k <= 0) return interpolateBreakpoints(breakpoints, x);
    return Math.round(Rmax * (1 - Math.exp(-k * x)) * 1e6) / 1e6;
  }
  return interpolateBreakpoints(breakpoints, x);
}

// ── Substrate-level adjustment coefficients ───────────────────────────────────
// NSPase ME release is substrate-dependent: much higher in wheat/barley diets
// than corn/soy diets. These multipliers adjust the curve value by wheat/barley
// content (as fraction of formula basis) in the LP solution.
// Source: Cowieson et al. 2014; Bedford & Partridge 2010.
const SUBSTRATE_COEFFICIENTS = {
  xylanase:     { wheat: 2.0, barley: 1.5, rye: 1.8, corn: 0.25, maize: 0.25 },
  beta_glucanase: { barley: 2.2, oat: 1.8, wheat: 0.5, corn: 0.15, maize: 0.15 },
  arabinoxylanase: { wheat: 2.0, barley: 1.5, rye: 1.8, corn: 0.25, maize: 0.25 },
};

// ── Multi-enzyme synergy table ────────────────────────────────────────────────
// When multiple enzyme types are present at effective doses, nutrient releases are
// super-additive (phytase frees P which reduces anti-nutrient load for xylanase, etc.)
// Values: fractional bonus added to the sum of individual nutrient releases.
// Source: Cowieson & Roos 2016; MDPI Applied Sciences 16:2862 (2025).
const SYNERGY_TABLE = {
  'phytase+protease':           { me: 0.12, sid_lys: 0.10, sid_met: 0.08, avp: 0.05 },
  'phytase+xylanase':           { me: 0.15, avp: 0.08 },
  'xylanase+protease':          { me: 0.10, sid_lys: 0.08 },
  'phytase+xylanase+protease':  { me: 0.22, sid_lys: 0.15, sid_met: 0.10, avp: 0.10 },
  'phytase+protease+amylase':   { me: 0.18, sid_lys: 0.12 },
  'xylanase+amylase':           { me: 0.12 },
};

// Enzyme-family identifiers used for synergy detection
const ENZYME_FAMILIES = {
  phytase: ['phytase', 'phytase_swine', 'phy'],
  xylanase: ['xylanase', 'xylanase_swine', 'arabinoxyl', 'nspase'],
  protease: ['protease'],
  amylase: ['amylase'],
  beta_glucanase: ['beta_glucanase', 'glucanase'],
};

function detectEnzymeFamilies(presentIngredientIds) {
  const families = new Set();
  for (const [family, keywords] of Object.entries(ENZYME_FAMILIES)) {
    if (presentIngredientIds.some(id => keywords.some(kw => String(id).toLowerCase().includes(kw)))) {
      families.add(family);
    }
  }
  return [...families].sort();
}

const BLEND_HINTS = ['blend', 'cocktail', 'multi-enzyme', 'multi_enzyme', 'multienzyme', 'combo'];
const MULTI_BLEND_FAMILIES = ['phytase', 'xylanase', 'protease', 'amylase'];

function familiesFromHaystack(haystack) {
  const h = String(haystack || '').toLowerCase();
  const families = [];
  for (const [family, keywords] of Object.entries(ENZYME_FAMILIES)) {
    if (keywords.some(kw => h.includes(kw))) families.push(family);
  }
  return families;
}

/** Single-family product vs multi-enzyme blend (from id + curve names). */
function classifyEnzymeProduct(ingId, curves) {
  const names = [ingId, ...(curves || []).map(c => c.curve_name)].filter(Boolean).join(' ');
  let families = familiesFromHaystack(names);
  const isBlend = BLEND_HINTS.some(h => names.toLowerCase().includes(h)) || families.length >= 2;
  if (isBlend && families.length === 0) families = [...MULTI_BLEND_FAMILIES];
  return { isBlend, families };
}

/**
 * Do not stack a blend with another product of the same family.
 * Two single phytases may both apply (superdose). Two overlapping blends may not.
 */
function computeBlendSuppression(classified) {
  const suppressed = {};
  const blendCovered = new Set();
  const coveringBlendByFamily = {};
  const blends = Object.entries(classified)
    .filter(([, c]) => c.isBlend)
    .sort((a, b) => b[1].families.length - a[1].families.length || String(a[0]).localeCompare(String(b[0])));
  for (const [id, cls] of blends) {
    const overlap = cls.families.filter(f => blendCovered.has(f));
    if (overlap.length) {
      suppressed[id] = {
        reason: 'blend_covers_family',
        covering_blend: coveringBlendByFamily[overlap[0]],
        families: cls.families
      };
      continue;
    }
    for (const f of cls.families) {
      blendCovered.add(f);
      coveringBlendByFamily[f] = id;
    }
  }
  for (const [id, cls] of Object.entries(classified)) {
    if (cls.isBlend) continue;
    const hit = cls.families.filter(f => blendCovered.has(f));
    if (hit.length) {
      suppressed[id] = {
        reason: 'blend_covers_family',
        covering_blend: coveringBlendByFamily[hit[0]],
        families: cls.families
      };
    }
  }
  return suppressed;
}

function parseEnzymeCreditSource(raw) {
  const map = {};
  if (!raw || typeof raw !== 'object') return map;
  for (const [id, v] of Object.entries(raw)) {
    const key = String(id || '').trim();
    if (!key) continue;
    const flag = String(v || 'curve').toLowerCase().replace(/[\s-]+/g, '_');
    if (flag === 'book' || flag === 'ingredient' || flag === 'mill') map[key] = 'book';
    else if (flag === 'none' || flag === 'no_credit' || flag === 'dont_credit' || flag === 'off') map[key] = 'none';
    else map[key] = 'curve';
  }
  return map;
}

function creditSourceFor(ingId, map) {
  if (!map || typeof map !== 'object') return 'curve';
  if (map[ingId]) return map[ingId];
  const hit = Object.keys(map).find(k => k.toLowerCase() === String(ingId).toLowerCase());
  return hit ? map[hit] : 'curve';
}

/** If a family is already credited from mill book values, do not also apply a curve on another product of that family. */
function suppressCurvesWhenFamilyBookCredited(classified, suppressed, creditMap) {
  const bookFamilies = new Set();
  for (const [id, cls] of Object.entries(classified)) {
    const src = creditSourceFor(id, creditMap);
    if (src === 'book' || src === 'none') {
      (cls.families || []).forEach(f => bookFamilies.add(f));
    }
  }
  if (!bookFamilies.size) return suppressed;
  const out = { ...suppressed };
  for (const [id, cls] of Object.entries(classified)) {
    if (out[id]) continue;
    if (creditSourceFor(id, creditMap) !== 'curve') continue;
    const hit = (cls.families || []).filter(f => bookFamilies.has(f));
    if (hit.length) {
      out[id] = { reason: 'family_already_credited', covering_blend: null, families: cls.families };
    }
  }
  return out;
}

function parseMatrixNutrientBasis(raw) {
  const withEnzyme = new Set();
  const basis = {};
  if (!raw || typeof raw !== 'object') return { withEnzyme, basis };
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k || '').trim().toLowerCase();
    if (!key) continue;
    const flag = String(v || 'native').toLowerCase().replace(/[\s-]+/g, '_');
    const withEnz = flag === 'with_enzyme' || flag === 'with_enz' || flag === 'already_with_enzyme';
    basis[key] = withEnz ? 'with_enzyme' : 'native';
    if (withEnz) withEnzyme.add(key);
  }
  return { withEnzyme, basis };
}

function getSynergyKey(families) {
  // Try most specific combination first, then pairs
  const keys = [families.join('+')];
  for (let i = 0; i < families.length; i++) {
    for (let j = i + 1; j < families.length; j++) {
      keys.push(families[i] + '+' + families[j]);
    }
  }
  for (const key of keys) {
    if (SYNERGY_TABLE[key]) return key;
  }
  return null;
}

const router = express.Router();

// __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CommonJS require from ESM
const require = createRequire(import.meta.url);
const { solveJsLpModel, solverPoolInfo } = require("../../../core/optimizer/solver/solverPool.cjs");

// Structured ingredient loader path
const ingredientsLoaderPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "core",
  "db",
  "ingredients",
  "_index",
  "LOAD_INGREDIENTS.cjs"
);

let loadIngredientsFn = null;
let lpSolverModule = null;

function loadIngredientsModule() {
  try {
    const mod = require(ingredientsLoaderPath);
    loadIngredientsFn =
      (mod && (mod.loadIngredients || mod.default || mod.LOAD_INGREDIENTS)) ||
      (typeof mod === "function" ? mod : null);
    return typeof loadIngredientsFn === "function";
  } catch (_err) {
    loadIngredientsFn = null;
    return false;
  }
}

function loadLpSolverModule() {
  try {
    const mod = require("javascript-lp-solver");
    lpSolverModule = mod || null;
    return !!lpSolverModule;
  } catch (_err) {
    lpSolverModule = null;
    return false;
  }
}

// Initial attempt
loadIngredientsModule();
loadLpSolverModule();

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function toNumber(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Real typed numbers only. Number(null) === 0, which must not override library ME/starch. */
function enteredNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const KCAL_PER_MJ = 239.0057361376673;

/** ME/AMEn/NE in kcal/kg for the LP. Frontend converts breed kcal/kg ↔ mill display (kcal/lb, MJ, Mcal).
 * Values under 80 in the kcal field are treated as MJ/kg (or Mcal if < 4.2). */
/** Rostagno 2024 broiler ME / AMEn / NE. Parser used to store hens ME or swine NE in these fields. */
function brazilianPoultryEnergyCanon(id, name) {
  const blob = `${id || ""} ${name || ""}`.toLowerCase();
  const c = blob.replace(/[^a-z0-9]+/g, "");
  if (/oil/.test(blob) && /soy|vegetable/.test(blob) && !/meal/.test(blob)) {
    return { me: 8790, amen: 8790, ne: 7460, linoleic: 53.5, wrong: {} };
  }
  if (/soybean_meal_46_5|soybean,\s*meal 46\.5/.test(blob) || /soybea001|sbm46/.test(c)) {
    return { me: 2296, amen: 2296, ne: 1771, wrong: { me: [2385], amen: [2035], ne: [1859, 2035] } };
  }
  if (/soybean_meal_44_5|soybean,\s*meal 44\.5/.test(blob)) return { me: 2212, amen: 2212, ne: 1715, wrong: { me: [2276], amen: [2538, 3396], ne: [1778] } };
  if (/soybean_meal_45_6|soybean,\s*meal 45\.6/.test(blob)) return { me: 2258, amen: 2538, ne: 1746, wrong: { me: [2332], ne: [1820] } };
  if (/soybean_meal_48|soybean,\s*meal 48/.test(blob)) return { me: 2295, amen: 2373, ne: 1769, wrong: { me: [2371], ne: [1845] } };
  if ((/canola_meal|canola,\s*meal/.test(blob) || /canola001/.test(c)) && !/oil/.test(blob)) {
    return { me: 1743, amen: 1932, ne: 1358, wrong: { me: [1856], ne: [1470] } };
  }
  if (/corn/.test(blob) && /grain|yellow|dent|average|corn0/.test(c + blob)) {
    return { me: 3364, amen: 3481, ne: 2711, wrong: { me: [3391], ne: [2738] } };
  }
  return null;
}

function energyKcalFromIngredient(ingredientRow, nutrientKey) {
  const k = normalizeKey(nutrientKey);
  const canon = brazilianPoultryEnergyCanon(
    millIngredientCode(ingredientRow) || ingredientRow?.id || ingredientRow?.requested_id,
    ingredientRow?.display_name || ingredientRow?.name
  );
  // Table ME always wins for named cereals/SBM/oil. Pellet QF must never be the energy coeff.
  if (canon && (k === "me" || k === "amen" || k === "ne") && isFiniteNumber(canon[k])) {
    return canon[k];
  }
  const aliases =
    k === "amen" ? ["amen", "amen_kcal_kg", "ame_n"] :
    k === "ne" ? ["ne", "ne_kcal_kg", "ne_kcal_per_kg"] :
    ["me", "me_kcal_per_kg", "me_poultry_kcal_kg", "me_hens_kcal_kg", "me_kcal_kg"];
  const direct = firstNumeric(ingredientRow, aliases);
  if (isFiniteNumber(direct) && direct >= 80) return round4(direct);
  // Real MJ/kg for cereals is ~11–16. Values 1–8 are pellet QF leaked into ME.
  if (isFiniteNumber(direct) && direct >= 8 && direct < 20) return round4(direct * KCAL_PER_MJ);
  if (isFiniteNumber(direct) && direct > 0 && direct < 4.2) return round4(direct * 1000);
  if (k === "me" || k === "amen") {
    const mj = firstNumeric(ingredientRow, ["me_mj", "me_mj_per_kg"]);
    if (isFiniteNumber(mj) && mj >= 8) return round4(mj * KCAL_PER_MJ);
  }
  return null;
}

function round4(v) {
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}

function sumBy(arr, fn) {
  return arr.reduce((s, x) => s + fn(x), 0);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function normalizeKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[%()+]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ── Canonical ingredient nutrient profiles (Rostagno 2017 / NRC 2012) ─────────
// Used as automatic fallback when the user's database is missing coefficients.
// Values are % of ingredient as-fed; ME in kcal/kg AMEn (poultry).
// Only fills cells that are genuinely zero/missing — user data is never overwritten.
const CANONICAL_FEED_PROFILES = [
  {
    match: /\b(corn|maize|zea\s*mays|mais)\b/i,
    exclude: /gluten|bran|germ|distill|ddgs|byproduct|by.product|cgm|steep|hominy/i,
    nutrients: {
      cp: 8.5, me: 3300, ee: 3.5, cf: 2.5, ash: 1.3, moisture: 12.0,
      ca: 0.02, total_p: 0.28, avp: 0.13, na: 0.02, k: 0.37, cl: 0.05,
      linoleic: 1.8, linolenic: 0.07,
      sid_lys: 0.24, sid_met: 0.17, sid_thr: 0.28, sid_trp: 0.06,
      sid_arg: 0.39, sid_val: 0.33, sid_ile: 0.28, sid_leu: 0.89,
      sid_his: 0.22, sid_phe: 0.35, sid_metcys: 0.32,
      total_lys: 0.27, total_met: 0.18, total_thr: 0.33, total_trp: 0.07,
      total_arg: 0.42, total_val: 0.38, total_ile: 0.32
    }
  },
  {
    match: /soybean.{0,8}(meal|cake|sbm|solv)|soya.{0,8}(meal|cake)|sbm\b|soy.{0,5}(meal|cake)/i,
    nutrients: {
      cp: 46.5, me: 2230, ee: 1.5, cf: 3.5, ash: 6.5, moisture: 12.0,
      ca: 0.25, total_p: 0.63, avp: 0.27, na: 0.01, k: 1.95, cl: 0.04,
      linoleic: 0.5, linolenic: 0.07,
      sid_lys: 2.82, sid_met: 0.65, sid_thr: 1.78, sid_trp: 0.60,
      sid_arg: 3.34, sid_val: 2.07, sid_ile: 1.99, sid_leu: 3.30,
      sid_his: 1.22, sid_phe: 2.14, sid_metcys: 1.30,
      total_lys: 2.95, total_met: 0.67, total_thr: 1.90, total_trp: 0.63,
      total_arg: 3.45, total_val: 2.18, total_ile: 2.10
    }
  },
  {
    match: /canola/i,
    nutrients: {
      cp: 36.0, me: 1860, ee: 3.5, cf: 11.0, ash: 7.0, moisture: 12.0,
      ca: 0.68, total_p: 1.17, avp: 0.40, na: 0.05, k: 1.35, cl: 0.14,
      linoleic: 0.8, linolenic: 0.3,
      sid_lys: 2.00, sid_met: 0.71, sid_thr: 1.52, sid_trp: 0.45,
      sid_arg: 2.26, sid_val: 1.92, sid_ile: 1.47, sid_leu: 2.77,
      sid_his: 0.96, sid_phe: 1.45, sid_metcys: 1.31,
      total_lys: 2.15, total_met: 0.75, total_thr: 1.65, total_trp: 0.48,
      total_arg: 2.42, total_val: 2.05, total_ile: 1.60
    }
  },
  {
    match: /sunflower.{0,10}(meal|cake|solvent|extract|expeller)/i,
    nutrients: {
      cp: 28.0, me: 1540, ee: 3.0, cf: 24.0, ash: 7.0, moisture: 12.0,
      ca: 0.35, total_p: 1.00, avp: 0.32, na: 0.03, k: 1.22, cl: 0.11,
      linoleic: 1.1, linolenic: 0.05,
      sid_lys: 1.00, sid_met: 0.74, sid_thr: 1.14, sid_trp: 0.37,
      sid_arg: 2.55, sid_val: 1.48, sid_ile: 1.08, sid_leu: 1.95,
      sid_his: 0.61, sid_phe: 1.28, sid_metcys: 1.31,
      total_lys: 1.10, total_met: 0.78, total_thr: 1.22, total_trp: 0.40,
      total_arg: 2.70, total_val: 1.60, total_ile: 1.20
    }
  },
  {
    match: /fish.{0,5}(meal|65|60|72)/i,
    nutrients: {
      cp: 65.0, me: 3100, ee: 10.0, cf: 0.5, ash: 15.0, moisture: 10.0,
      ca: 4.50, total_p: 2.90, avp: 2.90, na: 0.80, k: 0.90, cl: 1.00,
      sid_lys: 5.10, sid_met: 1.70, sid_thr: 2.70, sid_trp: 0.60,
      sid_arg: 3.90, sid_val: 3.20, sid_ile: 2.70, sid_leu: 4.80,
      sid_his: 1.60, sid_phe: 2.60, sid_metcys: 2.30,
      total_lys: 5.30, total_met: 1.80, total_thr: 2.85, total_trp: 0.65,
      total_arg: 4.10, total_val: 3.40, total_ile: 2.85
    }
  },
  {
    match: /poultry.{0,10}(by.?product|meal|pbm|offal)/i,
    nutrients: {
      cp: 58.0, me: 2820, ee: 14.0, cf: 2.0, ash: 18.0, moisture: 8.0,
      ca: 4.50, total_p: 2.70, avp: 2.70, na: 0.60, k: 0.50, cl: 0.40,
      sid_lys: 2.80, sid_met: 1.10, sid_thr: 1.90, sid_trp: 0.35,
      sid_arg: 3.60, sid_val: 2.80, sid_ile: 2.20, sid_leu: 4.10,
      sid_his: 1.00, sid_phe: 2.20, sid_metcys: 1.90
    }
  },
  {
    match: /wheat\b(?!.*germ)/i,
    exclude: /bran|shorts|middlings|flour|starch|gluten|germ/i,
    nutrients: {
      cp: 12.5, me: 3060, ee: 2.0, cf: 3.0, ash: 1.8, moisture: 12.0,
      ca: 0.06, total_p: 0.35, avp: 0.15, na: 0.01, k: 0.45, cl: 0.08,
      linoleic: 0.9, linolenic: 0.05,
      sid_lys: 0.35, sid_met: 0.23, sid_thr: 0.42, sid_trp: 0.14,
      sid_arg: 0.62, sid_val: 0.54, sid_ile: 0.40, sid_leu: 0.91,
      sid_his: 0.30, sid_phe: 0.58, sid_metcys: 0.45
    }
  },
  {
    match: /wheat.*(bran|shorts|middlings)/i,
    nutrients: {
      cp: 16.5, me: 1490, ee: 3.5, cf: 11.0, ash: 6.0, moisture: 12.0,
      ca: 0.12, total_p: 1.12, avp: 0.29, na: 0.03, k: 1.30,
      sid_lys: 0.53, sid_met: 0.26, sid_thr: 0.45, sid_trp: 0.18,
      sid_arg: 0.94, sid_val: 0.67, sid_ile: 0.42, sid_leu: 0.87,
      sid_metcys: 0.50
    }
  },
  {
    match: /corn.*(gluten|cgm)/i,
    nutrients: {
      cp: 60.0, me: 3500, ee: 5.0, cf: 2.0, ash: 2.0, moisture: 12.0,
      ca: 0.05, total_p: 0.50, avp: 0.25, na: 0.01,
      sid_lys: 0.95, sid_met: 1.50, sid_thr: 1.80, sid_trp: 0.30,
      sid_arg: 1.65, sid_val: 2.55, sid_ile: 2.00, sid_leu: 10.20,
      sid_metcys: 2.05
    }
  },
  {
    match: /soybean.*(full.?fat|whole|extruded|roasted)/i,
    nutrients: {
      cp: 36.0, me: 3400, ee: 18.0, cf: 5.0, ash: 5.0, moisture: 12.0,
      ca: 0.24, total_p: 0.56, avp: 0.24, na: 0.01, k: 1.70, linoleic: 9.5,
      sid_lys: 2.30, sid_met: 0.52, sid_thr: 1.44, sid_trp: 0.50,
      sid_arg: 2.75, sid_val: 1.68, sid_ile: 1.62, sid_leu: 2.70, sid_metcys: 1.08
    }
  },
  {
    match: /peanut.*(meal|cake|expeller)/i,
    nutrients: {
      cp: 46.0, me: 2280, ee: 7.0, cf: 14.0, ash: 6.0, moisture: 12.0,
      ca: 0.20, total_p: 0.60, avp: 0.22,
      sid_lys: 1.50, sid_met: 0.43, sid_thr: 1.10, sid_trp: 0.36,
      sid_arg: 4.60, sid_val: 1.60, sid_ile: 1.20, sid_leu: 2.60, sid_metcys: 0.90
    }
  },
  {
    match: /meat.*(bone|meal|mbm)/i,
    exclude: /feather/i,
    nutrients: {
      cp: 50.0, me: 2360, ee: 9.0, cf: 2.5, ash: 29.0, moisture: 8.0,
      ca: 9.50, total_p: 4.50, avp: 4.50, na: 0.70, k: 0.60, cl: 0.70,
      sid_lys: 2.50, sid_met: 0.60, sid_thr: 1.60, sid_trp: 0.25,
      sid_arg: 3.10, sid_val: 2.30, sid_ile: 1.70, sid_leu: 3.40, sid_metcys: 1.10
    }
  },
  {
    match: /feather.*(meal|hydrolyzed)/i,
    nutrients: {
      cp: 81.0, me: 2440, ee: 4.0, cf: 1.5, ash: 4.5, moisture: 8.0,
      ca: 0.20, total_p: 0.60, avp: 0.40,
      sid_lys: 1.70, sid_met: 0.70, sid_thr: 3.60, sid_trp: 0.50,
      sid_arg: 4.80, sid_val: 4.90, sid_ile: 3.10, sid_leu: 5.70, sid_metcys: 1.60
    }
  },
  {
    match: /limestone|calcium.?carbonate|calcite|caco3/i,
    nutrients: {
      cp: 0, me: 0, ee: 0, cf: 0, ash: 97.0, moisture: 1.0,
      ca: 38.0, total_p: 0.0, avp: 0.0, na: 0.01, k: 0.01, cl: 0.01
    }
  },
  {
    match: /dicalcium.?phosphate|\bdcp\b|dibasic.?calcium/i,
    nutrients: {
      cp: 0, me: 0, ee: 0, cf: 0, ash: 96.0, moisture: 2.0,
      ca: 22.0, total_p: 18.5, avp: 18.0, na: 0.15, k: 0.01
    }
  },
  {
    match: /monocalcium.?phosphate|\bmcp\b|monobasic.?calcium/i,
    nutrients: {
      cp: 0, me: 0, ee: 0, cf: 0, ash: 90.0, moisture: 2.0,
      ca: 17.0, total_p: 22.0, avp: 22.0, na: 0.15, k: 0.01
    }
  },
  {
    match: /\bsalt\b|sodium.?chloride|\bnacl\b/i,
    exclude: /bicarbonate|epsom|sulfate|mineral|premix/i,
    nutrients: {
      cp: 0, me: 0, ee: 0, cf: 0, ash: 98.0, moisture: 1.0,
      ca: 0.0, total_p: 0.0, avp: 0.0, na: 39.3, k: 0.01, cl: 60.0
    }
  },
  {
    match: /sodium.?bicarbonate|bicarb|nahco3/i,
    nutrients: {
      cp: 0, me: 0, ee: 0, cf: 0, ash: 98.5, moisture: 0.5,
      na: 27.4, cl: 0.0, k: 0.01
    }
  },
  {
    match: /soybean.?oil|soy.?oil|soya.?oil/i,
    nutrients: {
      cp: 0, me: 8200, ee: 99.0, cf: 0, ash: 0.1, moisture: 0.2,
      linoleic: 52.0, linolenic: 7.0
    }
  },
  {
    match: /palm.?oil/i,
    nutrients: {
      cp: 0, me: 8200, ee: 99.0, cf: 0, ash: 0.1, moisture: 0.2,
      linoleic: 10.0, linolenic: 0.4
    }
  },
  {
    match: /tallow|animal.?fat|lard/i,
    nutrients: {
      cp: 0, me: 7950, ee: 99.0, cf: 0, ash: 0.1, moisture: 0.2,
      linoleic: 4.0, linolenic: 0.5
    }
  },
  {
    match: /molasses|sugarcane.?molasses/i,
    nutrients: {
      cp: 5.5, me: 1400, ee: 0.5, cf: 0, ash: 11.0, moisture: 25.0,
      ca: 0.75, total_p: 0.10, avp: 0.05, na: 0.20, k: 4.50, cl: 1.50
    }
  },
  {
    match: /cassava|tapioca/i,
    exclude: /leaf|leaves/i,
    nutrients: {
      cp: 2.5, me: 3200, ee: 0.5, cf: 4.0, ash: 3.0, moisture: 12.0,
      ca: 0.10, total_p: 0.10, avp: 0.06, na: 0.02, k: 0.80
    }
  },
  {
    match: /sorghum|milo/i,
    nutrients: {
      cp: 11.0, me: 3270, ee: 3.3, cf: 3.0, ash: 1.6, moisture: 12.0,
      ca: 0.03, total_p: 0.28, avp: 0.11, na: 0.01, k: 0.40,
      sid_lys: 0.17, sid_met: 0.19, sid_thr: 0.31, sid_trp: 0.09,
      sid_arg: 0.35, sid_val: 0.44, sid_ile: 0.32, sid_leu: 1.20, sid_metcys: 0.34
    }
  },
  {
    match: /barley/i,
    nutrients: {
      cp: 11.5, me: 2790, ee: 2.2, cf: 5.5, ash: 2.5, moisture: 12.0,
      ca: 0.07, total_p: 0.35, avp: 0.14, na: 0.01, k: 0.55,
      sid_lys: 0.41, sid_met: 0.19, sid_thr: 0.37, sid_trp: 0.13,
      sid_arg: 0.55, sid_val: 0.54, sid_ile: 0.36, sid_leu: 0.74, sid_metcys: 0.38
    }
  },
];

function matchIngredientToCanonical(ingredientName, ingredientId) {
  const haystack = `${ingredientName || ''} ${ingredientId || ''}`.trim();
  if (!haystack) return null;
  for (const entry of CANONICAL_FEED_PROFILES) {
    if (entry.exclude && entry.exclude.test(haystack)) continue;
    if (entry.match.test(haystack)) return entry.nutrients;
  }
  return null;
}

const SYNTHETIC_AA_CANON = {
  lys: { total: 78.8, me: 0 },
  met: { total: 99, me: 0 },
  thr: { total: 98, me: 0 },
  trp: { total: 98, me: 0 },
  val: { total: 98.5, me: 0 },
  ile: { total: 98, me: 0 },
  arg: { total: 98, me: 0 },
  his: { total: 99, me: 0 },
  phe: { total: 99, me: 0 },
  leu: { total: 99, me: 0 }
};

function millIngredientCode(ing) {
  return String(ing?.ingredient_code || ing?.code || ing?.mill_code || "").trim();
}

function isUuidLike(s) {
  const t = String(s || "").trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return true;
  const c = t.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return c.length >= 32 && /^[0-9a-f]+$/.test(c);
}

function compactMillCode(code) {
  if (isUuidLike(code)) return "";
  return String(code || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isSyntheticAminoIdentity(id, name, category) {
  if (String(category || "").toLowerCase() === "synthetic_aa") return true;
  return syntheticAaKeysFromIdentity(id, name).length > 0;
}

/** Mill ingredient codes only (LTRYPT001). Never nutrient keys (sid_trp) and never mill UUIDs. */
function syntheticAaKeysFromIdentity(id, name) {
  const c = compactMillCode(id);
  const blob = String(name || "").toLowerCase();
  const keys = [];
  if (/lysine/.test(blob) || /^(lys|llys|lyshcl)/.test(c) || c.includes("lyshcl") || c.includes("lyssulf") || c.includes("lyssulph")) keys.push("lys");
  if ((/methionine/.test(blob) || /^(dlm|dlmet|lmet|met)/.test(c) || c.includes("dlmet")) && !c.includes("metcys") && !/met\s*\+|metcys|methionine\s*\+/.test(blob)) keys.push("met");
  if (/threonine/.test(blob) || /^(lthreo|lthr|thr)/.test(c) || c.includes("lthreo")) keys.push("thr");
  if (/tryptophan/.test(blob) || /^(ltrypt|trypt|ltrp|trp)/.test(c) || c.includes("ltrypt") || c.includes("trypt")) keys.push("trp");
  if (/valine/.test(blob) || /^(lvalin|lval|val)/.test(c) || c.includes("lvalin")) keys.push("val");
  if (/isoleucine/.test(blob) || /^(lisole|lile|ile)/.test(c) || c.includes("lisole")) keys.push("ile");
  if ((/leucine/.test(blob) && !/isoleucine/.test(blob)) || /^(lleuci|lleu)/.test(c) || c.includes("lleuci") || c.includes("lleu0")) keys.push("leu");
  if (/arginine/.test(blob) || /^(largini|larg|arg)/.test(c) || c.includes("largini")) keys.push("arg");
  if (/histidine/.test(blob) || /^(lhisti|lhis|his)/.test(c) || c.includes("lhisti")) keys.push("his");
  if ((/phenylalanine/.test(blob) || /^(lpheny|lphe|phe)/.test(c) || c.includes("lpheny")) && !c.includes("phetyr")) keys.push("phe");
  return keys;
}

function syntheticKeysForIngredient(ing) {
  return syntheticAaKeysFromIdentity(
    millIngredientCode(ing),
    ing?.display_name || ing?.name || ing?.requested_display_name || ing?.ingredient_name || ""
  );
}

function stampCrystalPurity(nutrientMatrix, ing, keys, millCode, name) {
  const blob = `${millCode || ""} ${name || ""}`.toLowerCase();
  const keep = new Set();
  for (const aa of keys) {
    const spec = SYNTHETIC_AA_CANON[aa];
    if (!spec) continue;
    let tot = spec.total;
    if (aa === "lys" && /sulph|sulfat/.test(blob)) tot = 54.6;
    keep.add(`sid_${aa}`);
    keep.add(`total_${aa}`);
    if (aa === "met") keep.add("sid_metcys");
    if (!nutrientMatrix[`sid_${aa}`]) nutrientMatrix[`sid_${aa}`] = {};
    nutrientMatrix[`sid_${aa}`][ing.id] = tot;
    if (!nutrientMatrix[`total_${aa}`]) nutrientMatrix[`total_${aa}`] = {};
    nutrientMatrix[`total_${aa}`][ing.id] = tot;
    if (aa === "met") {
      if (!nutrientMatrix.sid_metcys) nutrientMatrix.sid_metcys = {};
      nutrientMatrix.sid_metcys[ing.id] = tot;
    }
  }
  for (const nk of Object.keys(nutrientMatrix)) {
    if (!(nk.startsWith("sid_") || nk.startsWith("total_"))) continue;
    if (keep.has(nk)) continue;
    if (nutrientMatrix[nk] && nutrientMatrix[nk][ing.id] != null) nutrientMatrix[nk][ing.id] = 0;
  }
  // Crystals are micro AA sources only — never energy, protein, or fat fillers.
  for (const ek of ["me", "amen", "ne", "cp", "ee", "linoleic", "linolenic"]) {
    if (!nutrientMatrix[ek]) nutrientMatrix[ek] = {};
    nutrientMatrix[ek][ing.id] = 0;
  }
}

/** Crystalline AA coefficient = product purity. Mill ingredient codes only — never nutrient keys. */
function applyOilFattyAcidsToMatrix(nutrientMatrix, ingredientsEnabled) {
  for (const ing of ingredientsEnabled || []) {
    const blob = `${millIngredientCode(ing) || ""} ${ing.display_name || ing.name || ""}`.toLowerCase();
    if (!/oil|tallow|fat|lard|grease/.test(blob) || /meal/.test(blob)) continue;
    let linoleic = null;
    if (/soy|vegetable/.test(blob)) linoleic = 53.5;
    else if (/canola|rape/.test(blob)) linoleic = 18.7;
    else if (/corn|maize/.test(blob)) linoleic = 52;
    else if (/sunflower/.test(blob)) linoleic = 63;
    else if (/palm/.test(blob) && !/kernel/.test(blob)) linoleic = 10;
    if (linoleic == null) continue;
    if (!nutrientMatrix.linoleic) nutrientMatrix.linoleic = {};
    const cur = toNumber(nutrientMatrix.linoleic[ing.id], 0);
    if (!(cur > 5)) nutrientMatrix.linoleic[ing.id] = linoleic;
    if (!nutrientMatrix.ee) nutrientMatrix.ee = {};
    if (!(toNumber(nutrientMatrix.ee[ing.id], 0) > 80)) nutrientMatrix.ee[ing.id] = 99.5;
  }
}

function applySyntheticPurityToMatrix(nutrientMatrix, ingredientsEnabled) {
  for (const ing of ingredientsEnabled || []) {
    const millCode = millIngredientCode(ing);
    const name = ing.display_name || ing.name || ing.requested_display_name || ing.ingredient_name || "";
    const keys = syntheticAaKeysFromIdentity(millCode, name);
    if (!keys.length) continue;
    stampCrystalPurity(nutrientMatrix, ing, keys, millCode, name);
  }
  // Intact Trp is <1% of the ingredient (SBM ~0.58). A SID Trp coeff of ~4 is
  // purity×QF/100 on LTRYPT001, which makes the LP dose 0.158/4 ≈ 4% product.
  const trpMap = nutrientMatrix.sid_trp || {};
  for (const ing of ingredientsEnabled || []) {
    const v = Number(trpMap[ing.id]);
    if (!(v > 1.5 && v < 50)) continue;
    const already = syntheticKeysForIngredient(ing);
    if (already.length && !already.includes("trp")) continue;
    stampCrystalPurity(
      nutrientMatrix,
      ing,
      ["trp"],
      millIngredientCode(ing),
      ing.display_name || ing.name || ""
    );
  }
}

function canonicalizeSyntheticAminoRow(row, requestedId, requestedName) {
  const millCode = millIngredientCode(row) || (isUuidLike(requestedId) ? "" : requestedId);
  const name = requestedName || row?.display_name || row?.name || "";
  if (!isSyntheticAminoIdentity(millCode, name, row?.category)) return row;
  const out = { ...(row || {}), category: "synthetic_aa" };
  const blob = `${millCode} ${name} ${out.display_name || ""}`.toLowerCase();
  const keys = syntheticAaKeysFromIdentity(millCode, name);
  if (!keys.length && out.display_name) {
    keys.push(...syntheticAaKeysFromIdentity("", out.display_name));
  }
  for (const aa of keys) {
    const spec = SYNTHETIC_AA_CANON[aa];
    if (!spec) continue;
    const totKey = `total_${aa}`;
    const sidKey = `sid_${aa}`;
    // Product purity (% of product), never a digestibility coeff and never × pellet QF.
    let tot = spec.total;
    if (aa === "lys" && /sulph|sulfat/.test(blob)) tot = 54.6;
    const stored = Number(out[totKey]);
    if (isFiniteNumber(stored) && stored > 20 && stored <= 100 && !/sulph|sulfat/.test(blob)) tot = stored;
    out[totKey] = tot;
    out[sidKey] = tot;
    out[`dig_${aa}`] = 100;
    out[`sid_coef_${aa}`] = 100;
    out[`sid_coeff_${aa}`] = 100;
    if (aa === "met") out.sid_metcys = tot;
  }
  out.me = 0;
  out.amen = 0;
  out.ne = 0;
  out.cp = 0;
  out.ee = 0;
  const keep = new Set();
  for (const aa of keys) {
    keep.add(`total_${aa}`);
    keep.add(`sid_${aa}`);
    if (aa === "met") keep.add("sid_metcys");
  }
  for (const k of Object.keys(out)) {
    if ((k.startsWith("sid_") || k.startsWith("total_")) && !keep.has(k)) out[k] = 0;
  }
  return out;
}

// ── True LP Profit Objective: Species-specific nutrient revenue coefficients ───
// Basis: NRC nutrient requirements + typical production economics (NRC 1994/2001/2012).
// Revenue per unit nutrient = how much product revenue that nutrient generates per kg diet.
// Adjusted ingredient cost = price - Σ(revenue_coeff_j × nutrient_content_ij)
// Minimizing adjusted cost ≡ maximizing IOFC/max-profit → genuinely different LP solution.

function normalizeSpecies(species) {
  const s = String(species || "").toLowerCase().replace(/[^a-z]/g, "");
  if (["broiler","chicken","poultry","turkey","gallus"].some(k => s.includes(k))) return "broiler";
  if (["swine","pig","pork","hog","sow","gilt","boar"].some(k => s.includes(k))) return "swine";
  if (["dairy","milk","cow","cattle","bovine","ruminant","heifer","holstein"].some(k => s.includes(k))) return "dairy";
  if (["layer","laying","hen","egg"].some(k => s.includes(k))) return "layer";
  if (["beef","feedlot","steer"].some(k => s.includes(k))) return "beef";
  if (["aqua","fish","salmon","shrimp","tilapia"].some(k => s.includes(k))) return "aqua";
  return "generic";
}

function getSpeciesRevenueCoeffs(species, gainData, objective) {
  const pp  = toNumber(gainData?.product_price, 1.5);
  const fcr = toNumber(gainData?.fcr, 1.9) || 1.9;
  const dfi = toNumber(gainData?.daily_feed_intake, null);
  // max_profit is 20% more aggressive in crediting nutrient revenue than iofc
  const agg = objective === "max_profit" ? 1.20 : 1.00;
  const sp  = normalizeSpecies(species);

  if (sp === "broiler") {
    // ME response ~0.018 g ADG / kcal/kg; AA response from NRC 1994 Poultry
    return {
      me:      agg * 1.8e-5 * pp / fcr,
      amen:    agg * 1.8e-5 * pp / fcr,
      sid_lys: agg * 0.016 * pp / fcr,
      sid_met: agg * 0.011 * pp / fcr,
      sid_cys: agg * 0.006 * pp / fcr,
      sid_thr: agg * 0.008 * pp / fcr,
      sid_try: agg * 0.010 * pp / fcr,
      sid_val: agg * 0.006 * pp / fcr,
      sid_ile: agg * 0.006 * pp / fcr,
      sid_arg: agg * 0.007 * pp / fcr,
      sid_leu: agg * 0.005 * pp / fcr,
    };
  }
  if (sp === "swine") {
    // Tryptophan is frequently limiting in corn-SBM swine diets (higher coeff than broiler)
    return {
      me:      agg * 2.2e-5 * pp / fcr,
      sid_lys: agg * 0.014 * pp / fcr,
      sid_met: agg * 0.009 * pp / fcr,
      sid_thr: agg * 0.007 * pp / fcr,
      sid_try: agg * 0.011 * pp / fcr,
      sid_val: agg * 0.006 * pp / fcr,
      sid_ile: agg * 0.006 * pp / fcr,
      sid_arg: agg * 0.003 * pp / fcr,
    };
  }
  if (sp === "dairy") {
    // product_price = milk price $/kg; dfi = daily feed intake kg DM/cow/day (default 22)
    const mp = pp;
    const ef = dfi !== null ? dfi : 22;
    return {
      nel: agg * 0.0020 * mp * ef,  // $/Mcal NEL / kg diet
      ne:  agg * 0.0020 * mp * ef,
      me:  agg * 2.0e-6 * mp * ef,  // $/kcal/kg (= nel/1000 to avoid double-counting)
      cp:  agg * 2.0e-4 * mp * ef,  // $/% CP
      nfc: agg * 5.0e-4 * mp * ef,  // $/% NFC (fermentable starch → milk yield)
    };
  }
  if (sp === "layer") {
    // product_price = $/kg eggs (or $/dozen — user defines)
    return {
      me:      agg * 1.5e-5 * pp,
      amen:    agg * 1.5e-5 * pp,
      sid_lys: agg * 0.010 * pp,
      sid_met: agg * 0.009 * pp,
      ca:      agg * 0.002 * pp,  // shell quality
    };
  }
  if (sp === "beef") {
    return {
      me:      agg * 2.0e-5 * pp / fcr,
      sid_lys: agg * 0.010 * pp / fcr,
      sid_met: agg * 0.007 * pp / fcr,
      cp:      agg * 0.002 * pp / fcr,
    };
  }
  if (sp === "aqua") {
    return {
      me:      agg * 1.5e-5 * pp / fcr,
      cp:      agg * 0.004 * pp / fcr,
      sid_lys: agg * 0.012 * pp / fcr,
      sid_met: agg * 0.010 * pp / fcr,
    };
  }
  // Generic fallback
  return {
    me:      agg * 2.0e-5 * pp / fcr,
    amen:    agg * 2.0e-5 * pp / fcr,
    sid_lys: agg * 0.012 * pp / fcr,
    sid_met: agg * 0.008 * pp / fcr,
    sid_thr: agg * 0.006 * pp / fcr,
    sid_try: agg * 0.007 * pp / fcr,
  };
}

function buildProfitAdjustedCostVector({ objective, gainData, species, ingredientIds, ingredientCostVector, nutrientMatrix }) {
  const revenueCoeffs = getSpeciesRevenueCoeffs(species, gainData, objective);

  // Build a normalizedKey → original-key lookup for the nutrientMatrix
  const normToOriginal = {};
  for (const k of Object.keys(nutrientMatrix)) {
    normToOriginal[normalizeKey(k)] = k;
  }

  const adjustedCostVector = {};
  for (const ingId of ingredientIds) {
    let rev = 0;
    for (const [nutKey, coeff] of Object.entries(revenueCoeffs)) {
      const origKey = normToOriginal[normalizeKey(nutKey)];
      const val = origKey ? (nutrientMatrix[origKey]?.[ingId] ?? 0) : 0;
      rev += coeff * val;
    }
    adjustedCostVector[ingId] = round4((ingredientCostVector[ingId] ?? 0) - rev);
  }

  return { adjustedCostVector, nutrientEconomicValues: revenueCoeffs };
}
// ── End profit LP helpers ─────────────────────────────────────────────────────

function firstNumeric(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const v = enteredNumber(obj[key]);
    if (isFiniteNumber(v)) return v;
  }
  return null;
}


function getConstraintBands(nutrientKey) {
  const k = normalizeKey(nutrientKey);

  if (["me", "amen", "ne"].includes(k)) {
    return {
      numeric_tolerance: 0.0001,
      warn_band_below: 10,
      warn_band_above: 0
    };
  }

  return {
    numeric_tolerance: 0.001,
    warn_band_below: 0,
    warn_band_above: 0
  };
}
function validateIngredient(row, index) {
  const errors = [];
  const id = row?.id;
  const display_name = row?.display_name ?? row?.id ?? `ingredient_${index + 1}`;
  const min = row?.min == null ? null : toNumber(row?.min, null);
  const max = row?.max == null ? null : toNumber(row?.max, null);
  const cost = toNumber(row?.cost, null);
  const enabled = row?.enabled !== false;

  if (!id || typeof id !== "string") {
    errors.push(`ingredient_pool[${index}].id is required`);
  }
  if (!isFiniteNumber(min)) {
    errors.push(`ingredient_pool[${index}].min must be numeric`);
  }
  if (!isFiniteNumber(max)) {
    errors.push(`ingredient_pool[${index}].max must be numeric`);
  }
  if (!isFiniteNumber(cost)) {
    errors.push(`ingredient_pool[${index}].cost must be numeric`);
  }
  if (isFiniteNumber(min) && min < 0) {
    errors.push(`ingredient_pool[${index}].min cannot be negative`);
  }
  if (isFiniteNumber(max) && max < 0) {
    errors.push(`ingredient_pool[${index}].max cannot be negative`);
  }
  if (isFiniteNumber(min) && isFiniteNumber(max) && min > max) {
    errors.push(`ingredient_pool[${index}] min cannot be greater than max`);
  }

  return {
  errors,
  normalized: {
    ...row,  // preserve all payload fields (sid_leu, cp, ca, etc.) so LP can use them as fallback coefficients
    id,
    display_name,
    min: isFiniteNumber(min) ? round4(min) : null,
    max: isFiniteNumber(max) ? round4(max) : null,
    cost,
    enabled
  }
};
}

function validateConstraint(row, index) {
  const errors = [];
  const key = row?.key;
  const min = row?.min == null ? null : toNumber(row.min, null);
  const target = row?.target == null ? null : toNumber(row.target, null);
  const max = row?.max == null ? null : toNumber(row.max, null);
  let hardness = row?.hardness || null;

if (!hardness) {
  if (min != null || max != null) {
    hardness = "hard";
  } else if (target != null) {
    hardness = "soft";
  } else {
    hardness = "hard";
  }
}

  if (!key || typeof key !== "string") {
    errors.push(`nutrient_constraints[${index}].key is required`);
  }
  if (row?.min != null && !isFiniteNumber(min)) {
    errors.push(`nutrient_constraints[${index}].min must be numeric`);
  }
  if (row?.target != null && !isFiniteNumber(target)) {
    errors.push(`nutrient_constraints[${index}].target must be numeric`);
  }
  if (row?.max != null && !isFiniteNumber(max)) {
    errors.push(`nutrient_constraints[${index}].max must be numeric`);
  }
  if (min != null && max != null && min > max) {
    errors.push(`nutrient_constraints[${index}] min cannot be greater than max`);
  }

  return {
    errors,
    normalized: {
      key,
      min,
      target,
      max,
      hardness,
      spec_class: row?.spec_class || null,
      soft_max: row?.soft_max === true,
      penalty_low: row?.penalty_low == null ? null : toNumber(row.penalty_low, null),
      penalty_high: row?.penalty_high == null ? null : toNumber(row.penalty_high, null),
      penalty_target: row?.penalty_target == null ? null : toNumber(row.penalty_target, null)
    }
  };
}

function buildGreedyLeastCostBasisSolution(ingredientsEnabled, formulaBasis) {
  const byId = {};
  (ingredientsEnabled || []).forEach((ing) => { byId[ing.id] = ing; });
  const working = ingredientsEnabled.map(x => ({
    id: x.id,
    display_name: x.display_name,
    min: round4(x.min),
    max: round4(x.max),
    cost: x.cost,
    inclusion: round4(toNumber(x.min, 0))
  }));

  let remaining = round4(formulaBasis - sumBy(working, x => x.inclusion));

  const cheapestBulk = [...working].filter((item) => {
    const ing = byId[item.id];
    if (ingredientRole(ing) !== "macro") return false;
    const n = String(ing?.display_name || ing?.name || "").toLowerCase();
    return !/oil|tallow|molasses/.test(n);
  }).sort((a, b) => {
    if (a.cost !== b.cost) return a.cost - b.cost;
    return a.id.localeCompare(b.id);
  });

  for (const item of cheapestBulk) {
    if (remaining <= 0) break;

    const room = round4(item.max - item.inclusion);
    if (room <= 0) continue;

    const add = round4(Math.min(room, remaining));
    item.inclusion = round4(item.inclusion + add);
    remaining = round4(remaining - add);
  }

  const optimizedFormula = working
    .filter(x => x.inclusion > 0)
    .map(x => ({
      id: x.id,
      display_name: x.display_name,
      inclusion: round4(x.inclusion),
      cost: x.cost,
      cost_contribution: round4((x.inclusion / formulaBasis) * x.cost),
      status: "used"
    }));

  const totalInclusion = round4(sumBy(optimizedFormula, x => x.inclusion));
  const totalCostPerTon = round4(sumBy(optimizedFormula, x => x.cost_contribution));

  const atMin = working
    .filter(x => Math.abs(x.inclusion - x.min) <= 0.0001)
    .map(x => x.id);

  const atMax = working
    .filter(x => Math.abs(x.inclusion - x.max) <= 0.0001)
    .map(x => x.id);

  const excluded = working
    .filter(x => x.inclusion <= 0.0001)
    .map(x => x.id);

  return {
    optimizedFormula,
    totalInclusion,
    totalCostPerTon,
    remainingGap: round4(Math.max(0, remaining)),
    atMin,
    atMax,
    excluded,
    rawWorking: working
  };
}

function extractIngredientDb(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.db && typeof payload.db === "object") return payload.db;
  if (payload.ingredients && typeof payload.ingredients === "object") return payload.ingredients;
  if (payload.data && typeof payload.data === "object") return payload.data;
  return payload;
}

function loadIngredientDbForContext(context) {
  if (typeof loadIngredientsFn !== "function") {
    loadIngredientsModule();
  }
  if (typeof loadIngredientsFn !== "function") {
    return {
      ok: false,
      error: "Ingredient loader function not available",
      db: {},
      raw: null
    };
  }

  const reqObj = {
    locale: context.locale || "US",
    species: context.species || "poultry",
    type: context.type || "broiler",
    production: context.production || "",
    breed: context.breed || "generic",
    region: context.region || "us",
    version: context.version || "v1"
  };

  const attempts = [
    () => loadIngredientsFn(reqObj),
    () => loadIngredientsFn(reqObj.species, reqObj.type, reqObj.region, reqObj.version),
    () => loadIngredientsFn(reqObj.species, reqObj.region, reqObj.version),
    () => loadIngredientsFn()
  ];

  let raw = null;
  let lastError = null;

  for (const fn of attempts) {
    try {
      raw = fn();
      if (raw) break;
    } catch (err) {
      lastError = err;
    }
  }

  const db = extractIngredientDb(raw);

  if (!db || typeof db !== "object" || Array.isArray(db)) {
    return {
      ok: false,
      error: lastError?.message || "Ingredient DB could not be loaded",
      db: {},
      raw
    };
  }

  return {
    ok: true,
    error: null,
    db,
    raw
  };
}

function buildResolverAliases(requestedId, requestedDisplayName) {
  // IMPORTANT: Only use display-name-based synonyms here.
  // Never use ingredient code patterns (e.g. /^corn\d*$/) because user codes
  // like CORN017 can mean ANY ingredient type (Corn Gluten Feed, not Corn Grain).
  // The display_name prefix fallback in resolveIngredientRecord handles the rest.
  const source = [requestedId, requestedDisplayName]
    .filter(Boolean)
    .map(normalizeKey);

  const set = new Set(source);

  for (const s of source) {
    if (!s) continue;

    // Corn grain — only when the display name actually says "corn grain" or "maize grain"
    if (s === "corn_grain" || s === "maize_grain" || s === "corn" || s === "maize") {
      set.add("corn_grain_avg");
      set.add("corn_grain");
      set.add("maize");
      set.add("maize_grain");
    }

    // Soybean meal — only when display name starts with soybean_meal
    if (s.startsWith("soybean_meal") || s.startsWith("soy_bean_meal")) {
      set.add("soybean_meal_48_cp");
      set.add("soybean_meal_46_5_cp");
      set.add("soybean_meal_45_6_cp_avg");
      set.add("soybean_meal");
    }

    // Fish meal — display name based
    if (s.startsWith("fish_meal") || s === "fish_meal") {
      set.add("fish_meal_65_cp");
      set.add("fish_meal_60_cp");
      set.add("fish_meal");
    }

    // Poultry by-product meal — display name based
    if (s.includes("poultry") && (s.includes("byproduct") || s.includes("by_product") || s.includes("meal"))) {
      set.add("poultry_byproduct_meal");
      set.add("poultry_meal");
      set.add("poultry_by_product_meal");
    }

    // Limestone
    if (s === "limestone" || s === "calcium_carbonate" || s === "caco3") {
      set.add("limestone");
      set.add("calcium_carbonate");
      set.add("caco3");
    }

    // DCP
    if (s === "dicalcium_phosphate" || s === "dcp") {
      set.add("dicalcium_phosphate");
      set.add("dcp");
    }

    // MCP
    if (s === "monocalcium_phosphate" || s === "mcp") {
      set.add("monocalcium_phosphate");
      set.add("mcp");
    }

    // Salt
    if (s === "salt" || s === "nacl" || s === "sodium_chloride") {
      set.add("salt");
      set.add("nacl");
      set.add("sodium_chloride");
    }

    // Sodium bicarbonate
    if (s === "sodium_bicarbonate" || s === "nahco3" || s.includes("bicarb")) {
      set.add("sodium_bicarbonate");
      set.add("nahco3");
    }

    // Canola
    if (s.startsWith("canola")) {
      set.add("canola_meal");
      set.add("canola_meal_00");
    }

    // Sunflower
    if (s.startsWith("sunflower")) {
      set.add("sunflower_meal");
      set.add("sunflower_seed_meal");
    }

    if (s === "oil" || s === "vegetable_oil") {
      set.add("soybean_degummed_oil");
      set.add("soybean_acid_oil");
      set.add("canola_oil");
      set.add("corn_oil");
      set.add("vegetable_oil");
    }

    if (s === "l_lys_hcl" || s === "lysine_hcl" || s === "l_lysine_hcl" || s.includes("lysine")) {
      set.add("l_lys_hcl");
      set.add("l_lysine_hcl");
    }

    if (s === "l_thr" || s === "l_threonine" || s.includes("threonine")) {
      set.add("l_thr");
      set.add("l_threonine");
    }

    if (s === "dl_met" || s === "dl_methionine" || s === "dlm" || s.includes("methionine")) {
      set.add("dl_met");
      set.add("dl_methionine");
    }
  }

  return [...set];
}

function resolveIngredientRecord(db, requestedId, requestedDisplayName = "") {
  const targets = buildResolverAliases(requestedId, requestedDisplayName);

  for (const alias of targets) {
    for (const [dbKey, row] of Object.entries(db || {})) {
      const dbKeyNorm = normalizeKey(dbKey);
      if (dbKeyNorm === alias) {
        return { db_key: dbKey, row, resolution_method: "db_key_or_alias" };
      }
    }

    for (const [dbKey, row] of Object.entries(db || {})) {
      const displayName = row?.display_name || row?.name || "";
      const displayNorm = normalizeKey(displayName);
      if (displayNorm === alias) {
        return { db_key: dbKey, row, resolution_method: "display_name_or_alias" };
      }
    }
  }

  // Prefix fallback: "corn_grain" matches "corn_grain_avg", "soybean_meal" matches "soybean_meal_48_cp" etc.
  const normalizedId = normalizeKey(requestedId);
  const normalizedName = normalizeKey(requestedDisplayName);
  for (const [dbKey, row] of Object.entries(db || {})) {
    const dbKeyNorm = normalizeKey(dbKey);
    if ((normalizedId && dbKeyNorm.startsWith(normalizedId) && dbKeyNorm.length - normalizedId.length <= 8) ||
        (normalizedName && dbKeyNorm.startsWith(normalizedName) && dbKeyNorm.length - normalizedName.length <= 8)) {
      return { db_key: dbKey, row, resolution_method: "prefix_fallback" };
    }
    const displayNorm = normalizeKey(row?.display_name || row?.name || "");
    if (normalizedName && displayNorm && displayNorm.startsWith(normalizedName) && displayNorm.length - normalizedName.length <= 8) {
      return { db_key: dbKey, row, resolution_method: "display_prefix_fallback" };
    }
  }

  return null;
}

// Load all cidb_*.json files for a user and return a flat name/id/code index.
// This is the user's active ingredient database (FACT DB) — primary nutrient source.
function loadUserFactDb(username, activeDbId) {
  const index = {};
  if (!username) return index;
  const safeUser = username.replace(/@/g, '_').replace(/\./g, '_');
  const dataDir = path.join(__dirname, '..', '..', '..', 'data', 'custom_ingredient_dbs', 'lite_' + safeUser);
  if (!fs.existsSync(dataDir)) return index;
  let files;
  try {
    const all = fs.readdirSync(dataDir).filter(f => f.startsWith('cidb_') && f.endsWith('.json'));
    // Only load the active database; never merge inactive ones
    files = activeDbId ? all.filter(f => f === activeDbId + '.json') : all;
  } catch { return index; }
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
      const arr = Array.isArray(raw.ingredients || raw)
        ? (raw.ingredients || raw)
        : Object.values(raw.ingredients || raw);
      for (const ing of arr) {
        if (!ing || !ing.ingredient_name) continue;
        index[normalizeKey(ing.ingredient_name)] = ing;
        if (ing.ingredient_id) index[normalizeKey(ing.ingredient_id)] = ing;
        if (ing.ingredient_code != null) index[String(ing.ingredient_code)] = ing;
      }
    } catch {}
  }
  return index;
}

function deriveSidFromTotalAndDigestibility(totalValue, digValue) {
  if (!isFiniteNumber(totalValue)) return null;
  if (!isFiniteNumber(digValue)) return null;
  return round4(totalValue * (digValue / 100));
}

function expandConstraintRowsForPercentBasis(nutrientConstraints, formulaBasis = 100) {
  const rows = [];

  for (const c of nutrientConstraints) {
    const coeffs = c.coefficients || {};

    if (isFiniteNumber(c.min)) {
      rows.push({
        nutrient: c.nutrient,
        sense: ">=",
        rhs: round4(c.min * formulaBasis),
        coefficients: coeffs,
        hardness: c.hardness,
        source: "min"
      });
    }

    if (isFiniteNumber(c.max)) {
      rows.push({
        nutrient: c.nutrient,
        sense: "<=",
        rhs: round4(c.max * formulaBasis),
        coefficients: coeffs,
        hardness: c.hardness,
        source: "max"
      });
    }
  }

  return rows;
}

function getNutrientValueForKey(ingredientRow, nutrientKey) {
  const k = normalizeKey(nutrientKey);
  const synRow = canonicalizeSyntheticAminoRow(
    ingredientRow,
    millIngredientCode(ingredientRow),
    ingredientRow?.display_name || ingredientRow?.name || ingredientRow?.ingredient_name
  );
  if (synRow && synRow.category === "synthetic_aa") {
    if (k === 'me' || k === 'amen' || k === 'ne') {
      const energy = energyKcalFromIngredient(synRow, k);
      if (isFiniteNumber(energy) && energy > 0) return energy;
    }
    const synVal = firstNumeric(synRow, [k, k + '_pct']);
    if (isFiniteNumber(synVal)) return synVal;
  }

  if (k === 'me' || k === 'amen' || k === 'ne') {
    const energy = energyKcalFromIngredient(ingredientRow, k);
    if (isFiniteNumber(energy) && energy > 0) return energy;
  }

  if (k.startsWith('sid_') && k !== 'sid_metcys' && k !== 'sid_met_cys') {
    const aa = k.slice(4);
    const direct = firstNumeric(ingredientRow, [k, k + '_pct', 'sid_' + aa.replace(/cys$/, 'cys')]);
    if (isFiniteNumber(direct)) return direct;
    const total = firstNumeric(ingredientRow, ['total_' + aa, aa, aa + '_pct']);
    const dig = firstNumeric(ingredientRow, ['dig_' + aa, 'sid_coeff_' + aa, 'digestibility_' + aa]);
    // Pellet QF is 0–6. Do not treat it as ileal digestibility.
    const digOk = isFiniteNumber(dig) && dig >= 20 && dig <= 100;
    const derived = digOk ? deriveSidFromTotalAndDigestibility(total, dig) : null;
    if (isFiniteNumber(derived)) return derived;
  }

  const directAliases = {
    me: ["me", "me_kcal_per_kg", "me_poultry_kcal_kg", "me_hens_kcal_kg"],
    cp: ["cp", "cp_pct"],
    ca: ["ca", "calcium", "ca_pct"],
    avp: ["avp", "available_p", "available_phosphorus", "p_avail_pct"],
    na: ["na", "sodium"],
    cl: ["cl", "chloride"],
    total_p: ["total_p", "p_total"],

    sid_lys: ["sid_lys", "sid_lys_pct"],
    sid_met: ["sid_met", "sid_met_pct"],
    sid_thr: ["sid_thr", "sid_thr_pct"],
    sid_trp: ["sid_trp", "sid_trp_pct"],

    total_lys: ["total_lys", "lys", "lys_pct"],
    total_met: ["total_met", "met", "met_pct"],
    total_thr: ["total_thr", "thr", "thr_pct"],
    total_trp: ["total_trp", "trp", "trp_pct"]
  };

  if (k === "sid_lys") {
    const direct = firstNumeric(ingredientRow, ["sid_lys", "sid_lys_pct"]);
    if (isFiniteNumber(direct)) return direct;

    const totalLys = firstNumeric(ingredientRow, ["total_lys", "lys", "lys_pct"]);
    const digLys = firstNumeric(ingredientRow, ["dig_lys", "sid_coeff_lys", "digestibility_lys"]);
    return deriveSidFromTotalAndDigestibility(totalLys, digLys);
  }

  if (k === "sid_met") {
    const direct = firstNumeric(ingredientRow, ["sid_met", "sid_met_pct"]);
    if (isFiniteNumber(direct)) return direct;

    const totalMet = firstNumeric(ingredientRow, ["total_met", "met", "met_pct"]);
    const digMet = firstNumeric(ingredientRow, ["dig_met", "sid_coeff_met", "digestibility_met"]);
    return deriveSidFromTotalAndDigestibility(totalMet, digMet);
  }

  if (k === "sid_thr") {
    const direct = firstNumeric(ingredientRow, ["sid_thr", "sid_thr_pct"]);
    if (isFiniteNumber(direct)) return direct;

    const totalThr = firstNumeric(ingredientRow, ["total_thr", "thr", "thr_pct"]);
    const digThr = firstNumeric(ingredientRow, ["dig_thr", "sid_coeff_thr", "digestibility_thr"]);
    return deriveSidFromTotalAndDigestibility(totalThr, digThr);
  }

  if (k === "sid_trp") {
    const direct = firstNumeric(ingredientRow, ["sid_trp", "sid_trp_pct"]);
    if (isFiniteNumber(direct)) return direct;

    const totalTrp = firstNumeric(ingredientRow, ["total_trp", "trp", "trp_pct"]);
    const digTrp = firstNumeric(ingredientRow, ["dig_trp", "sid_coeff_trp", "digestibility_trp"]);
    return deriveSidFromTotalAndDigestibility(totalTrp, digTrp);
  }

  if (k === "sid_metcys") {
    let direct = firstNumeric(ingredientRow, [
      "sid_metcys",
      "sid_met_cys",
      "sid_met_plus_cys",
      "sid_methionine_cystine"
    ]);
    if (direct === 0) direct = null;

    const totalMetCys = firstNumeric(ingredientRow, [
      "total_metcys",
      "metcys",
      "met_cys",
      "methionine_cystine"
    ]);
    const digMetCys = firstNumeric(ingredientRow, [
      "dig_metcys",
      "sid_coeff_metcys",
      "digestibility_metcys"
    ]);
    const fromMetCys = deriveSidFromTotalAndDigestibility(totalMetCys, digMetCys);

    const sidMet = getNutrientValueForKey(ingredientRow, "sid_met");
    const totalCys = firstNumeric(ingredientRow, ["total_cys", "cys", "cys_pct"]);
    const digCys = firstNumeric(ingredientRow, ["dig_cys", "sid_coeff_cys", "digestibility_cys"]);
    const sidCys = firstNumeric(ingredientRow, ["sid_cys", "sid_cys_pct"])
      ?? deriveSidFromTotalAndDigestibility(totalCys, digCys);
    const sum = (isFiniteNumber(sidMet) ? sidMet : 0) + (isFiniteNumber(sidCys) ? sidCys : 0);

    // Prefer Met+Cys parts (or total×dig) when stored SID Met+Cys is an OCR/underfill.
    if (isFiniteNumber(direct) && sum > direct + 0.08) {
      if (isFiniteNumber(fromMetCys) && Math.abs(fromMetCys - direct) <= 0.05) return direct;
      if (isFiniteNumber(fromMetCys) && fromMetCys > direct + 0.05) return round4(fromMetCys);
      if (sum > 0) return round4(sum);
    }
    if (isFiniteNumber(direct) && direct > 0) return direct;
    if (isFiniteNumber(fromMetCys)) return fromMetCys;
    if (sum > 0) return round4(sum);
    return null;
  }

  if (k === "total_metcys") {
    const direct = firstNumeric(ingredientRow, [
      "total_metcys",
      "metcys",
      "met_cys",
      "methionine_cystine"
    ]);
    if (isFiniteNumber(direct)) return direct;

    const totalMet = firstNumeric(ingredientRow, ["total_met", "met", "met_pct"]);
    const totalCys = firstNumeric(ingredientRow, ["total_cys", "cys", "cys_pct"]);
    if (isFiniteNumber(totalMet) && isFiniteNumber(totalCys)) {
      return round4(totalMet + totalCys);
    }
    return null;
  }

  const baseK = k.endsWith('_pct') ? k.slice(0, -4) : null;
  return firstNumeric(ingredientRow, directAliases[k] || (baseK ? [k, baseK] : [k]));
}

/**
 * NEW FUNCTION 1
 * Enterprise deviation variables for soft min/max/target handling.
 * Hard constraints stay hard.
 * Soft constraints introduce nonnegative penalty variables.
 */
function buildDeviationVariables({
  constraintsAll,
  nutrientMatrix,
  formulaBasis,
  penalties = {}
}) {
  const variableIds = [];
  const variableBoundsMap = {};
  const variableObjectiveMap = {};
  const solverRows = [];
  const diagnostics = [];

  const defaultPenaltyLow = toNumber(penalties?.nutrient_low, 20000);
const defaultPenaltyHigh = toNumber(penalties?.nutrient_high, 20000);
const defaultPenaltyTarget = toNumber(penalties?.nutrient_target, 2000);
// Hard constraints use a 50× higher penalty than soft so they are overwhelmingly
// preferred, but the LP stays feasible even when constraints conflict — instead of
// returning `feasible: false`, it returns a best-effort solution and reports which
// constraints were violated via the deviation variable values.
const HARD_CONSTRAINT_PENALTY = 1_000_000;

  for (const c of constraintsAll || []) {
    const nutrientKey = c.key;
    const keyNorm = normalizeKey(nutrientKey);
    const hardness = normalizeKey(c.hardness || "hard");
    const coeffsBase = { ...(nutrientMatrix?.[nutrientKey] || {}) };

    const penaltyLow = toNumber(c.penalty_low, defaultPenaltyLow);
    const penaltyHigh = toNumber(c.penalty_high, defaultPenaltyHigh);
    const penaltyTarget = toNumber(c.penalty_target, defaultPenaltyTarget);

    if (hardness !== "soft") {
      if (isFiniteNumber(c.min)) {
        // Penalised hard-min: LP will never voluntarily violate this (1M penalty/unit),
        // but it won't go infeasible if the constraint genuinely cannot be met.
        const varId = `dev_hard_low__${keyNorm}`;
        variableIds.push(varId);
        variableBoundsMap[varId] = { min: 0 };
        variableObjectiveMap[varId] = HARD_CONSTRAINT_PENALTY;
        solverRows.push({
          nutrient: nutrientKey,
          sense: ">=",
          rhs: round4(c.min * formulaBasis),
          coefficients: { ...coeffsBase, [varId]: 1 },
          hardness: "hard",
          source: "min"
        });
        diagnostics.push({
          nutrient: nutrientKey,
          deviation_variable: varId,
          deviation_type: "hard_deficit_to_min",
          penalty: HARD_CONSTRAINT_PENALTY
        });
      }

      if (isFiniteNumber(c.max) && c.soft_max !== true) {
        // Penalised hard-max: symmetric treatment.
        const varId = `dev_hard_high__${keyNorm}`;
        variableIds.push(varId);
        variableBoundsMap[varId] = { min: 0 };
        variableObjectiveMap[varId] = HARD_CONSTRAINT_PENALTY;
        solverRows.push({
          nutrient: nutrientKey,
          sense: "<=",
          rhs: round4(c.max * formulaBasis),
          coefficients: { ...coeffsBase, [varId]: -1 },
          hardness: "hard",
          source: "max"
        });
        diagnostics.push({
          nutrient: nutrientKey,
          deviation_variable: varId,
          deviation_type: "hard_excess_above_max",
          penalty: HARD_CONSTRAINT_PENALTY
        });
      }
    }

    const useSoftMin = hardness === "soft" && isFiniteNumber(c.min);
    const useSoftMax = (hardness === "soft" || c.soft_max === true) && isFiniteNumber(c.max);

    if (useSoftMin) {
      const varId = `dev_low__${keyNorm}`;
      variableIds.push(varId);
      variableBoundsMap[varId] = { min: 0 };
      variableObjectiveMap[varId] = penaltyLow;

      solverRows.push({
        nutrient: nutrientKey,
        sense: ">=",
        rhs: round4(c.min * formulaBasis),
        coefficients: {
          ...coeffsBase,
          [varId]: 1
        },
        hardness: "soft",
        source: "min"
      });

      diagnostics.push({
        nutrient: nutrientKey,
        deviation_variable: varId,
        deviation_type: "deficit_to_min",
        penalty: penaltyLow
      });
    }

    if (useSoftMax) {
      const varId = `dev_high__${keyNorm}`;
      variableIds.push(varId);
      variableBoundsMap[varId] = { min: 0 };
      variableObjectiveMap[varId] = penaltyHigh;

      solverRows.push({
        nutrient: nutrientKey,
        sense: "<=",
        rhs: round4(c.max * formulaBasis),
        coefficients: {
          ...coeffsBase,
          [varId]: -1
        },
        hardness: "soft",
        source: "max"
      });

      diagnostics.push({
        nutrient: nutrientKey,
        deviation_variable: varId,
        deviation_type: "excess_above_max",
        penalty: penaltyHigh
      });
    }

    if (isFiniteNumber(c.target) && isFiniteNumber(penaltyTarget) && penaltyTarget > 0) {
      const varHighId = `dev_target_high__${keyNorm}`;
      variableIds.push(varHighId);
      variableBoundsMap[varHighId] = { min: 0 };
      variableObjectiveMap[varHighId] = penaltyTarget;
      solverRows.push({
        nutrient: nutrientKey,
        sense: "<=",
        rhs: round4(c.target * formulaBasis),
        coefficients: {
          ...coeffsBase,
          [varHighId]: -1
        },
        hardness: "soft",
        source: "target_high"
      });
      diagnostics.push({
        nutrient: nutrientKey,
        deviation_variable: varHighId,
        deviation_type: "above_target",
        penalty: penaltyTarget
      });

      if (hardness === "soft" || !isFiniteNumber(c.min)) {
        const varLowId = `dev_target_low__${keyNorm}`;
        variableIds.push(varLowId);
        variableBoundsMap[varLowId] = { min: 0 };
        variableObjectiveMap[varLowId] = penaltyTarget;
        solverRows.push({
          nutrient: nutrientKey,
          sense: ">=",
          rhs: round4(c.target * formulaBasis),
          coefficients: {
            ...coeffsBase,
            [varLowId]: 1
          },
          hardness: "soft",
          source: "target_low"
        });
        diagnostics.push({
          nutrient: nutrientKey,
          deviation_variable: varLowId,
          deviation_type: "below_target",
          penalty: penaltyTarget
        });
      }
    }
  }

  return {
    variable_ids: variableIds,
    variable_bounds_map: variableBoundsMap,
    variable_objective_map: variableObjectiveMap,
    solver_rows: solverRows,
    diagnostics
  };
}

/**
 * No single intact meal should cover most of a SID amino acid. Soft slack so
 * lysine can come from corn + SBM + canola + synthetics instead of SBM alone.
 */
function buildIntactShareConstraints({
  constraintsAll,
  nutrientMatrix,
  ingredientsEnabled,
  formulaBasis,
  share = 0.45
}) {
  const solverRows = [];
  const variableBoundsMap = {};
  const objectiveMap = {};
  const aaKeys = (constraintsAll || []).filter((c) => {
    const k = String(c.key || "").toLowerCase();
    if (!k.startsWith("sid_") || k === "sid_leu") return false;
    return isFiniteNumber(c.min) && c.min > 0;
  });
  for (const c of aaKeys) {
    const coeffs = nutrientMatrix[c.key] || {};
    const rhs = round4(share * c.min * formulaBasis);
    if (!(rhs > 0)) continue;
    for (const ing of ingredientsEnabled || []) {
      if (syntheticKeysForIngredient(ing).length) continue;
      const coef = toNumber(coeffs[ing.id], 0);
      if (!(coef > 0.05)) continue;
      const slackId = `share_slack__${normalizeKey(c.key)}__${normalizeKey(ing.id)}`;
      variableBoundsMap[slackId] = { min: 0 };
      objectiveMap[slackId] = 800;
      solverRows.push({
        nutrient: `share_${c.key}_${ing.id}`,
        sense: "<=",
        rhs,
        coefficients: { [ing.id]: coef, [slackId]: -1 },
        hardness: "soft",
        source: "intact_share"
      });
    }
  }
  return { solver_rows: solverRows, variable_bounds_map: variableBoundsMap, objective_map: objectiveMap };
}

/** If the LP left empty mass (89% diets), fill to 100% from unused meals then cheapest energy. */
function fillRemainingToBasis(formula, ingredientsEnabled, formulaBasis, nutrientMatrix) {
  let cur = (formula || []).map((r) => ({ ...r }));
  let gap = round4(formulaBasis - sumBy(cur, (x) => x.inclusion));
  if (gap <= 0.05) return cur;
  const meMap = nutrientMatrix?.me || nutrientMatrix?.amen || {};
  const candidates = (ingredientsEnabled || [])
    .filter((ing) => ingredientRole(ing) === "macro")
    .map((ing) => {
      const row = cur.find((r) => r.id === ing.id);
      const inc = row ? toNumber(row.inclusion, 0) : 0;
      const maxB = toNumber(ing.max, formulaBasis);
      const room = round4(maxB - inc);
      const me = toNumber(meMap[ing.id], 0);
      const n = String(ing.display_name || ing.name || "").toLowerCase();
      const bulk = /corn|maize|wheat|sorghum|barley|soy|canola|rape|sunflower|gluten|ddgs|distiller|bran|fish|poultry by|meal/.test(n)
        && !/oil|tallow|molasses/.test(n);
      return { ing, row, inc, room, me, cost: toNumber(ing.cost, 99), bulk };
    })
    .filter((x) => x.room > 0.01 && (x.bulk || x.me > 500))
    .sort((a, b) => {
      const aCorn = /corn|maize/.test(String(a.ing.display_name || "").toLowerCase()) && !/gluten|oil|bran/.test(String(a.ing.display_name || "").toLowerCase()) ? 0 : 1;
      const bCorn = /corn|maize/.test(String(b.ing.display_name || "").toLowerCase()) && !/gluten|oil|bran/.test(String(b.ing.display_name || "").toLowerCase()) ? 0 : 1;
      if (aCorn !== bCorn) return aCorn - bCorn;
      return a.cost - b.cost;
    });
  const addOnto = (c, add) => {
    if (!c.row) {
      c.row = {
        id: c.ing.id,
        display_name: c.ing.display_name,
        inclusion: 0,
        cost: c.ing.cost,
        cost_contribution: 0,
        status: "used"
      };
      cur.push(c.row);
    }
    c.row.inclusion = round4(c.row.inclusion + add);
  };
  for (const c of candidates) {
    if (gap <= 0.05) break;
    const add = Math.min(c.room, gap);
    addOnto(c, add);
    gap = round4(gap - add);
  }
  if (gap > 0.05) {
    for (const ing of ingredientsEnabled || []) {
      if (gap <= 0.05) break;
      if (ingredientRole(ing) !== "macro") continue;
      const n = String(ing.display_name || ing.name || "").toLowerCase();
      if (/oil|tallow|molasses/.test(n) && gap > 3) continue;
      let row = cur.find((r) => r.id === ing.id);
      const inc = row ? toNumber(row.inclusion, 0) : 0;
      const maxB = toNumber(ing.max, formulaBasis);
      const room = round4(maxB - inc);
      if (room < 0.01) continue;
      const add = Math.min(room, gap);
      if (!row) {
        row = {
          id: ing.id,
          display_name: ing.display_name,
          inclusion: 0,
          cost: ing.cost,
          cost_contribution: 0,
          status: "used"
        };
        cur.push(row);
      }
      row.inclusion = round4(row.inclusion + add);
      gap = round4(gap - add);
    }
  }
  return cur.map((row) => ({
    ...row,
    cost_contribution: round4((row.inclusion / formulaBasis) * toNumber(row.cost, 0))
  }));
}

function ingredientRole(ing) {
  if (syntheticKeysForIngredient(ing).length) return "crystal";
  const n = `${ing?.id || ""} ${ing?.display_name || ""} ${ing?.name || ""}`.toLowerCase();
  if (/\bsalt\b|sodium chloride|\bnacl\b/.test(n) && !/epsom/.test(n)) return "micro";
  if (/bicarbonate|nahco3/.test(n)) return "micro";
  if (/\bpremix\b/.test(n)) return "micro";
  if (/choline/.test(n)) return "micro";
  if (/phytase|enzyme|toxin|binder|coccid/.test(n)) return "micro";
  if (/limestone|calcium carbonate|caco3/.test(n)) return "mineral";
  if (/dicalcium|monocalcium|\bdcp\b|\bmcp\b/.test(n) && !/phytase/.test(n)) return "mineral";
  return "macro";
}

function isLayerContext(context) {
  const blob = `${context?.species || ""} ${context?.type || ""} ${context?.production || ""} ${context?.phase || ""}`.toLowerCase();
  return /layer|lay_|lay-|breeder|hen/.test(blob);
}

function safetyMaxForIngredient(ing, context) {
  const role = ingredientRole(ing);
  const n = `${ing?.id || ""} ${ing?.display_name || ""} ${ing?.name || ""}`.toLowerCase();
  if (role === "crystal") return crystalPracticalMax(ing);
  if (/\bsalt\b|sodium chloride|\bnacl\b/.test(n) && !/epsom/.test(n)) return 0.45;
  if (/bicarbonate|nahco3/.test(n)) return 0.4;
  if (/\bpremix\b/.test(n)) return 1;
  if (/choline/.test(n)) return 0.2;
  if (/limestone|calcium carbonate|caco3/.test(n)) return isLayerContext(context) ? 12 : 2.5;
  if (/dicalcium|monocalcium|\bdcp\b|\bmcp\b/.test(n)) return 2.5;
  if (/oil|tallow|lard|grease/.test(n) && !/meal/.test(n)) return 6;
  if (/molasses/.test(n)) return 4;
  return 100;
}

function applyIngredientRoleCaps(ingredientsEnabled, context) {
  return (ingredientsEnabled || []).map((ing) => {
    const cap = safetyMaxForIngredient(ing, context);
    const role = ingredientRole(ing);
    let min = toNumber(ing.min, 0) || 0;
    let max = toNumber(ing.max, 100);
    if (!(max > 0)) max = 100;
    if (cap < 100) {
      max = Math.min(max, cap);
      if (min > max) min = 0;
    }
    if (role === "micro" && min > cap) min = 0;
    return { ...ing, min: round4(min), max: round4(max) };
  });
}

function applyNutrientBands(constraintsAll, context) {
  const layer = isLayerContext(context);
  for (const c of constraintsAll || []) {
    const k = String(c.key || "").toLowerCase();
    if (k === "ca" || k === "ca_pct") {
      if (isFiniteNumber(c.min) && !isFiniteNumber(c.max)) {
        c.max = round4(Math.min(c.min * 1.08, layer ? 5.5 : 1.3));
      }
      if (isFiniteNumber(c.max) && isFiniteNumber(c.min) && c.min > c.max) c.min = c.max;
    }
    if (k === "na" || k === "na_pct") {
      if (!isFiniteNumber(c.max)) c.max = 0.28;
      if (isFiniteNumber(c.min) && c.min > c.max) c.min = c.max;
    }
    if (k === "cl" || k === "cl_pct") {
      if (!isFiniteNumber(c.max)) c.max = 0.35;
      if (isFiniteNumber(c.min) && c.min > c.max) c.min = c.max;
    }
    if (k === "avp" || k === "avp_pct" || k === "p_avail" || k === "available_p") {
      if (isFiniteNumber(c.min) && !isFiniteNumber(c.max)) c.max = round4(c.min * 1.25);
      // avP typed as target-only (no min/max): lock it as a hard ceiling so DCP/phytase
      // are not over-dosed beyond the requirement.
      if (!isFiniteNumber(c.max) && isFiniteNumber(c.target) && !isFiniteNumber(c.min)) {
        c.max = c.target;
        c.hardness = "hard";
      }
    }
    if (k === "cp" || k === "cp_pct" || k === "crude_protein") {
      if (isFiniteNumber(c.min) && !isFiniteNumber(c.max)) c.max = round4(c.min * 1.35);
      // CP floor must be hard so it survives triage mode caused by unresolvable SID-AA
      // hard violations. The frontend sends a soft 8000-penalty floor (target*0.85) which
      // is dwarfed by 1M SID-AA violations — the LP ignores it and falls to minimum-cost corn.
      if (isFiniteNumber(c.min) && String(c.hardness || "hard").toLowerCase() !== "hard") {
        c.hardness = "hard";
      }
      // Fallback: if CP has a target only (no min), add hard floor 1% below requirement.
      if (!isFiniteNumber(c.min) && isFiniteNumber(c.target)) {
        c.min = round4(Math.max(0, c.target - 1.0));
        c.hardness = "hard";
      }
    }
  }
  return constraintsAll;
}

function restampCosts(cur, formulaBasis) {
  return (cur || []).map((row) => ({
    ...row,
    cost_contribution: round4((row.inclusion / formulaBasis) * toNumber(row.cost, 0))
  })).filter((row) => row.inclusion > 0.0001);
}

function largestMacroDonor(cur, ingredientsEnabled) {
  const byId = {};
  (ingredientsEnabled || []).forEach((ing) => { byId[ing.id] = ing; });
  let donor = null;
  for (const row of cur || []) {
    const ing = byId[row.id];
    if (!ing || ingredientRole(ing) !== "macro") continue;
    const minB = toNumber(ing.min, 0);
    const give = toNumber(row.inclusion, 0) - minB;
    if (give < 0.01) continue;
    if (!donor || row.inclusion > donor.row.inclusion) donor = { row, give, ing };
  }
  return donor;
}

function ensureRow(cur, ing) {
  let row = cur.find((r) => r.id === ing.id);
  if (!row) {
    row = {
      id: ing.id,
      display_name: ing.display_name,
      inclusion: 0,
      cost: ing.cost,
      cost_contribution: 0,
      status: "used"
    };
    cur.push(row);
  }
  return row;
}

/** Size limestone / DCP / salt to Ca, AvP, Na, Cl. Never use them as cheap 100% filler. */
function balanceMineralsToSpecs(formula, ingredientsEnabled, constraintsAll, nutrientMatrix, formulaBasis, context) {
  let cur = (formula || []).map((r) => ({ ...r }));
  const spec = (key) => {
    const aliases = [key, `${key}_pct`];
    if (key === "avp") aliases.push("p_avail", "available_p");
    return (constraintsAll || []).find((c) => aliases.includes(String(c.key || "").toLowerCase())) || {};
  };
  const actualOf = (key) => toNumber(calculateNutrientResultsFromFormula(cur, nutrientMatrix, formulaBasis)?.[key], 0);
  const moveCarrier = (matchRole, nutrientKey, minV, maxV, coeffFloor) => {
    const carrier = (ingredientsEnabled || []).find((ing) => matchRole(ing));
    if (!carrier) return;
    const coeff = toNumber((nutrientMatrix[nutrientKey] || {})[carrier.id], 0);
    if (!(coeff >= coeffFloor)) return;
    const actual = actualOf(nutrientKey);
    let goal = actual;
    if (isFiniteNumber(minV) && actual < minV) goal = minV;
    else if (isFiniteNumber(maxV) && actual > maxV) goal = maxV;
    else return;
    const deltaInc = ((goal - actual) * formulaBasis) / coeff;
    const row = ensureRow(cur, carrier);
    const maxB = toNumber(carrier.max, safetyMaxForIngredient(carrier, context));
    const minB = toNumber(carrier.min, 0);
    let next = row.inclusion + deltaInc;
    next = Math.max(minB, Math.min(maxB, next));
    const add = round4(next - row.inclusion);
    if (Math.abs(add) < 0.001) return;
    if (add > 0) {
      const donor = largestMacroDonor(cur, ingredientsEnabled);
      if (!donor) return;
      const take = Math.min(donor.give, add);
      row.inclusion = round4(row.inclusion + take);
      donor.row.inclusion = round4(donor.row.inclusion - take);
    } else {
      row.inclusion = round4(Math.max(minB, row.inclusion + add));
      const corn = (ingredientsEnabled || []).find((ing) => {
        const n = String(ing.display_name || "").toLowerCase();
        return ingredientRole(ing) === "macro" && /corn|maize/.test(n) && !/gluten|oil|bran/.test(n);
      }) || (ingredientsEnabled || []).find((ing) => ingredientRole(ing) === "macro");
      if (corn) {
        const grow = ensureRow(cur, corn);
        const room = toNumber(corn.max, 100) - grow.inclusion;
        grow.inclusion = round4(grow.inclusion + Math.min(room, Math.abs(add)));
      }
    }
  };
  const ca = spec("ca");
  moveCarrier((ing) => ingredientRole(ing) === "mineral" && /limestone|calcium carbonate|caco3/.test(`${ing.display_name || ""}`.toLowerCase()), "ca", ca.min, ca.max, 20);
  const avp = spec("avp");
  moveCarrier((ing) => ingredientRole(ing) === "mineral" && /dicalcium|monocalcium|\bdcp\b|\bmcp\b/.test(`${ing.display_name || ""} ${ing.id || ""}`.toLowerCase()), "avp", avp.min, avp.max, 10);
  const na = spec("na");
  const cl = spec("cl");
  moveCarrier((ing) => ingredientRole(ing) === "micro" && /\bsalt\b|nacl|sodium chloride/.test(`${ing.display_name || ""}`.toLowerCase()), "na", na.min, na.max, 20);
  // NaHCO3 as secondary Na source — used when salt hits its safety max and Na is still short
  moveCarrier((ing) => ingredientRole(ing) === "micro" && /bicarbonate|nahco3/.test(`${ing.display_name || ""}`.toLowerCase()), "na", na.min, na.max, 20);
  if (isFiniteNumber(cl.min) || isFiniteNumber(cl.max)) {
    moveCarrier((ing) => ingredientRole(ing) === "micro" && /\bsalt\b|nacl|sodium chloride/.test(`${ing.display_name || ""}`.toLowerCase()), "cl", cl.min, cl.max, 30);
  }
  return restampCosts(cur, formulaBasis);
}

/** Crystals sit inside the 100% mix. Not 0.25% mill default; not 100%. Lys can go past 0.25. */
function crystalPracticalMax(ing) {
  const keys = syntheticKeysForIngredient(ing);
  if (!keys.length) return toNumber(ing?.max, 100);
  const byAa = { lys: 1.5, met: 0.8, thr: 0.6, val: 0.5, ile: 0.5, arg: 0.5, trp: 0.3, his: 0.4, phe: 0.4, leu: 0.4 };
  const cap = Math.max(...keys.map((k) => byAa[k] || 0.5));
  const userMax = toNumber(ing?.max, null);
  if (userMax != null && userMax > 0.26) return Math.min(userMax, 2);
  return cap;
}

/** After a 100% basal mix, finish SID floors with crystals (Lys-HCl, DLM, Thr, …). */
function topUpSidWithSynthetics(formula, ingredientsEnabled, constraintsAll, nutrientMatrix, formulaBasis) {
  const ingById = {};
  (ingredientsEnabled || []).forEach((ing) => { ingById[ing.id] = ing; });
  let cur = (formula || []).map((r) => ({ ...r }));
  const aa = (constraintsAll || []).filter((c) => {
    const k = String(c.key || "").toLowerCase();
    return k.startsWith("sid_") && k !== "sid_leu" && isFiniteNumber(c.min);
  });
  const donorOf = () => largestMacroDonor(cur, ingredientsEnabled);
  for (const c of aa) {
    for (let step = 0; step < 10; step++) {
      const actual = toNumber(
        calculateNutrientResultsFromFormula(cur, nutrientMatrix, formulaBasis)?.[c.key],
        0
      );
      if (actual + 1e-4 >= c.min) break;
      const aaName = String(c.key).toLowerCase().replace(/^sid_/, "").replace(/_pct$/, "");
      const synIng = (ingredientsEnabled || []).find((ing) => {
        const keys = syntheticKeysForIngredient(ing);
        if (!keys.length) return false;
        if (aaName === "metcys") return keys.includes("met");
        return keys.includes(aaName);
      });
      if (!synIng) break;
      const coeff = toNumber((nutrientMatrix[c.key] || {})[synIng.id], 0);
      if (!(coeff > 1)) break;
      let row = cur.find((r) => r.id === synIng.id);
      const inc = row ? toNumber(row.inclusion, 0) : 0;
      const room = crystalPracticalMax(synIng) - inc;
      if (room < 0.001) break;
      const donor = donorOf();
      if (!donor) break;
      const add = Math.min(room, donor.give, Math.max(0.01, ((c.min - actual) * formulaBasis) / coeff + 0.002));
      if (!row) {
        row = {
          id: synIng.id,
          display_name: synIng.display_name,
          inclusion: 0,
          cost: synIng.cost,
          cost_contribution: 0,
          status: "used"
        };
        cur.push(row);
      }
      row.inclusion = round4(row.inclusion + add);
      donor.row.inclusion = round4(donor.row.inclusion - add);
    }
  }
  return cur.map((row) => ({
    ...row,
    cost_contribution: round4((row.inclusion / formulaBasis) * toNumber(row.cost, 0))
  })).filter((row) => row.inclusion > 0.0001);
}

/**
 * NEW FUNCTION 2
 * Movement variables to penalize movement away from starting formula.
 * move_up_i >= x_i - start_i
 * move_down_i >= start_i - x_i
 */
function buildMovementVariables({
  ingredientsEnabled,
  startingFormula,
  penalties = {}
}) {
  const variableIds = [];
  const variableBoundsMap = {};
  const variableObjectiveMap = {};
  const solverRows = [];
  const diagnostics = [];

  const defaultPenaltyMovement = toNumber(penalties?.movement, 1);
  const startingMap = buildStartingFormulaMap(startingFormula);
  const hasStartingFormula = Object.keys(startingMap).length > 0;

  if (!hasStartingFormula) {
    return {
      variable_ids: [],
      variable_bounds_map: {},
      variable_objective_map: {},
      solver_rows: [],
      diagnostics: [],
      has_starting_formula: false
    };
  }

  for (const ing of ingredientsEnabled || []) {
    const ingNorm = normalizeKey(ing.id);
    const startInclusion = round4(toNumber(startingMap?.[ing.id]?.inclusion, 0));
    const movePenalty = toNumber(
      ing?.movement_penalty,
      defaultPenaltyMovement
    );

    const moveUpId = `move_up__${ingNorm}`;
    const moveDownId = `move_down__${ingNorm}`;

    variableIds.push(moveUpId, moveDownId);
    variableBoundsMap[moveUpId] = { min: 0 };
    variableBoundsMap[moveDownId] = { min: 0 };
    variableObjectiveMap[moveUpId] = movePenalty;
    variableObjectiveMap[moveDownId] = movePenalty;

    // x - move_up <= start
    solverRows.push({
      nutrient: `movement_${ing.id}`,
      sense: "<=",
      rhs: startInclusion,
      coefficients: {
        [ing.id]: 1,
        [moveUpId]: -1
      },
      hardness: "soft",
      source: "move_up"
    });

    // x + move_down >= start
    solverRows.push({
      nutrient: `movement_${ing.id}`,
      sense: ">=",
      rhs: startInclusion,
      coefficients: {
        [ing.id]: 1,
        [moveDownId]: 1
      },
      hardness: "soft",
      source: "move_down"
    });

    diagnostics.push({
      ingredient_id: ing.id,
      start_inclusion: startInclusion,
      move_up_variable: moveUpId,
      move_down_variable: moveDownId,
      penalty: movePenalty
    });
  }

  return {
    variable_ids: variableIds,
    variable_bounds_map: variableBoundsMap,
    variable_objective_map: variableObjectiveMap,
    solver_rows: solverRows,
    diagnostics,
    has_starting_formula: true
  };
}

/**
 * NEW FUNCTION 3
 * Final objective = ingredient cost + nutrient deviation penalties + movement penalties
 */
function buildObjectiveFunction({
  ingredientIds,
  ingredientCostVector,
  deviationBuild,
  movementBuild
}) {
  const mergedCostVector = {};
  const seen = new Set();

  for (const id of ingredientIds || []) {
    mergedCostVector[id] = toNumber(ingredientCostVector?.[id], 0);
    seen.add(id);
  }

  for (const [id, val] of Object.entries(deviationBuild?.variable_objective_map || {})) {
    mergedCostVector[id] = toNumber(val, 0);
    seen.add(id);
  }

  for (const [id, val] of Object.entries(movementBuild?.variable_objective_map || {})) {
    mergedCostVector[id] = toNumber(val, 0);
    seen.add(id);
  }

  return {
    all_variable_ids: [...seen],
    objective_cost_vector: mergedCostVector,
    extra_variable_bounds_map: {
      ...(deviationBuild?.variable_bounds_map || {}),
      ...(movementBuild?.variable_bounds_map || {})
    },
    objective_breakdown: {
      ingredient_variables: ingredientIds || [],
      deviation_variables: deviationBuild?.variable_ids || [],
      movement_variables: movementBuild?.variable_ids || []
    }
  };
}

function buildJavascriptLpModel({
  allVariableIds,
  objectiveCostVector,
  variableBoundsMap,
  basisConstraint,
  solverReadyConstraints
}) {
  const constraints = {
    basis_eq: {
      equal: basisConstraint.rhs
    }
  };

  for (const id of allVariableIds) {
    const b = variableBoundsMap[id] || null;

    if (b && isFiniteNumber(b.min)) {
      constraints[`var_${id}_min`] = { min: b.min };
    }
    if (b && isFiniteNumber(b.max)) {
      constraints[`var_${id}_max`] = { max: b.max };
    }
  }

  solverReadyConstraints.forEach((row, idx) => {
    const key = `${normalizeKey(row.nutrient)}_${row.source}_${idx}`;
    if (row.sense === ">=") {
      constraints[key] = { min: row.rhs };
    } else if (row.sense === "<=") {
      constraints[key] = { max: row.rhs };
    } else if (row.sense === "=") {
      constraints[key] = { equal: row.rhs };
    }
  });

  const variables = {};

  for (const id of allVariableIds) {
    const v = {
      cost: toNumber(objectiveCostVector?.[id], 0),
      basis_eq: toNumber(basisConstraint?.coefficients?.[id], 0)
    };

    const b = variableBoundsMap[id] || null;
    if (b && isFiniteNumber(b.min)) {
      v[`var_${id}_min`] = 1;
    }
    if (b && isFiniteNumber(b.max)) {
      v[`var_${id}_max`] = 1;
    }

    solverReadyConstraints.forEach((row, idx) => {
      const key = `${normalizeKey(row.nutrient)}_${row.source}_${idx}`;
      v[key] = toNumber(row.coefficients?.[id], 0);
    });

    variables[id] = v;
  }

  return {
    optimize: "cost",
    opType: "min",
    constraints,
    variables
  };
}

async function solveWithJavascriptLp(model) {
  return solveJsLpModel(model);
}

function dualForConstraint(duals, nutrient, source) {
  const prefix = `${normalizeKey(nutrient)}_${source}_`;
  for (const [name, val] of Object.entries(duals || {})) {
    if (String(name).startsWith(prefix) && isFiniteNumber(val)) return Number(val);
  }
  return null;
}

function hardMinsMissed(formula, constraintsAll, nutrientMatrix, formulaBasis) {
  const results = calculateNutrientResultsFromFormula(formula, nutrientMatrix, formulaBasis);
  const missed = [];
  for (const c of constraintsAll || []) {
    if (normalizeKey(c.hardness || "hard") === "soft") continue;
    if (!isFiniteNumber(c.min)) continue;
    const actual = toNumber(results?.[c.key], null);
    if (!isFiniteNumber(actual)) continue;
    const k = String(c.key || "").toLowerCase();
    const tol = (k === "me" || k === "amen" || k === "ne") ? 0.25 : 1e-4;
    if (actual + tol < c.min) {
      missed.push({ key: c.key, min: c.min, actual });
    }
  }
  return missed;
}

/** Snap macros to 0.1% and micros to 0.01%, then keep only if cost does not rise and hard STD/min still hold. */
function applyMillSnapIfNotWorse(lpFormula, ingredientsEnabled, formulaBasis, constraintsAll, nutrientMatrix) {
  const ingMap = {};
  (ingredientsEnabled || []).forEach(ing => { ingMap[ing.id] = ing; });
  const lpCost = round4(sumBy(lpFormula || [], x => x.cost_contribution));
  const snapped = (lpFormula || []).map(row => {
    const ing = ingMap[row.id] || {};
    const maxB = toNumber(ing.max, 100);
    const minB = toNumber(ing.min, 0);
    const step = (maxB <= 5 || toNumber(row.inclusion, 0) < 1.25) ? 0.01 : 0.1;
    let inc = Math.round(toNumber(row.inclusion, 0) / step) * step;
    if (isFiniteNumber(minB)) inc = Math.max(minB, inc);
    if (isFiniteNumber(maxB)) inc = Math.min(maxB, inc);
    return { ...row, inclusion: round4(inc) };
  });
  let gap = round4(formulaBasis - sumBy(snapped, x => x.inclusion));
  if (Math.abs(gap) > 0.0001) {
    const roomy = snapped
      .map((row, i) => {
        const ing = ingMap[row.id] || {};
        if (gap > 0 && ingredientRole(ing) !== "macro") return { i, cost: 99, room: 0 };
        const maxB = toNumber(ing.max, formulaBasis);
        const minB = toNumber(ing.min, 0);
        const room = gap > 0 ? round4(maxB - row.inclusion) : round4(row.inclusion - minB);
        return { i, cost: toNumber(row.cost, 99), room };
      })
      .filter(x => x.room > 0.0001)
      .sort((a, b) => (gap > 0 ? a.cost - b.cost : b.cost - a.cost));
    for (const r of roomy) {
      if (Math.abs(gap) <= 0.0001) break;
      const add = Math.min(r.room, Math.abs(gap)) * Math.sign(gap);
      snapped[r.i].inclusion = round4(snapped[r.i].inclusion + add);
      gap = round4(gap - add);
    }
  }
  const out = snapped.map(row => ({
    ...row,
    cost_contribution: round4((row.inclusion / formulaBasis) * toNumber(row.cost, 0))
  }));
  const snapCost = round4(sumBy(out, x => x.cost_contribution));
  const lpTotal = round4(sumBy(lpFormula || [], x => x.inclusion));
  const snapTotal = round4(sumBy(out, x => x.inclusion));
  const filledGap = lpTotal + 0.05 < formulaBasis && snapTotal + 0.02 >= Math.min(formulaBasis, lpTotal + 0.2);
  const eps = 0.000005;
  if (constraintsAll && nutrientMatrix && !filledGap) {
    const missed = hardMinsMissed(out, constraintsAll, nutrientMatrix, formulaBasis);
    if (missed.length) {
      return { formula: lpFormula, applied: false, delta: isFiniteNumber(snapCost) ? round4(snapCost - lpCost) : null, nutrient_block: missed };
    }
  }
  // Filling 89% → 100% always raises cost. Mass balance still wins.
  if (filledGap) {
    return { formula: out, applied: true, delta: isFiniteNumber(snapCost) ? round4(snapCost - lpCost) : null };
  }
  if (!isFiniteNumber(snapCost) || snapCost > lpCost + eps) {
    return { formula: lpFormula, applied: false, delta: isFiniteNumber(snapCost) ? round4(snapCost - lpCost) : null };
  }
  return { formula: out, applied: true, delta: round4(snapCost - lpCost) };
}

/** If the JS LP or snap left a hard STD/min short, add the cheapest source and take mass from the largest row. */
function repairHardMinShortages(formula, ingredientsEnabled, constraintsAll, nutrientMatrix, formulaBasis) {
  const ingById = {};
  (ingredientsEnabled || []).forEach(ing => { ingById[ing.id] = ing; });
  let cur = (formula || []).map(r => ({ ...r }));
  for (let n = 0; n < 12; n++) {
    const missed = hardMinsMissed(cur, constraintsAll, nutrientMatrix, formulaBasis);
    if (!missed.length) return cur;
    const m = missed[0];
    const coeffs = nutrientMatrix[m.key] || {};
    let best = null;
    const isSid = String(m.key || "").toLowerCase().startsWith("sid_");
    const aaName = String(m.key || "").toLowerCase().replace(/^sid_/, "").replace(/_pct$/, "");
    const consider = (ing, inclusion) => {
      const syn = syntheticKeysForIngredient(ing).length > 0;
      if (!isSid && syn) return;
      if (isSid && syn) {
        const keys = syntheticKeysForIngredient(ing);
        const match = aaName === "metcys" ? keys.includes("met") : keys.includes(aaName);
        if (!match) return;
      }
      const coeff = toNumber(coeffs[ing.id], 0);
      if (!(coeff > 0)) return;
      const maxB = syn ? crystalPracticalMax(ing) : toNumber(ing.max, 100);
      const room = maxB - inclusion;
      if (room < 0.001) return;
      const score = coeff / Math.max(toNumber(ing.cost, 0), 1e-9);
      if (!best || score > best.score) best = { ing, coeff, room, score, inclusion };
    };
    for (const row of cur) {
      const ing = ingById[row.id];
      if (ing) consider(ing, toNumber(row.inclusion, 0));
    }
    for (const ing of ingredientsEnabled || []) {
      if (cur.some(r => r.id === ing.id)) continue;
      consider(ing, toNumber(ing.min, 0));
    }
    if (!best) return cur;
    let donor = null;
    for (const row of cur) {
      if (row.id === best.ing.id) continue;
      const ing = ingById[row.id];
      if (!ing || ingredientRole(ing) !== "macro") continue;
      const minB = toNumber(ing?.min, 0);
      const give = toNumber(row.inclusion, 0) - minB;
      if (give < 0.01) continue;
      if (!donor || row.inclusion > donor.row.inclusion) donor = { row, give };
    }
    if (!donor) return cur;
    const add = Math.min(best.room, donor.give, Math.max(0.01, (m.min - m.actual) * formulaBasis / best.coeff + 0.002));
    let target = cur.find(r => r.id === best.ing.id);
    if (!target) {
      target = {
        id: best.ing.id,
        display_name: best.ing.display_name,
        inclusion: toNumber(best.ing.min, 0),
        cost: best.ing.cost,
        cost_contribution: 0,
        status: "used"
      };
      cur.push(target);
    }
    target.inclusion = round4(target.inclusion + add);
    donor.row.inclusion = round4(donor.row.inclusion - add);
    cur = cur.map(row => ({
      ...row,
      cost_contribution: round4((row.inclusion / formulaBasis) * toNumber(row.cost, 0))
    })).filter(row => row.inclusion > 0.0001);
  }
  return cur;
}

function buildOptimizedFormulaFromLpResult(variableIds, ingredientsEnabled, result, formulaBasis) {
  const ingredientMap = {};
  ingredientsEnabled.forEach(ing => {
    ingredientMap[ing.id] = ing;
  });

  const optimizedFormula = [];

  for (const id of variableIds) {
    const ing = ingredientMap[id];
    if (!ing) continue;

    const inclusion = round4(toNumber(result?.[id], 0));
    if (inclusion <= 0.0001) continue;

    optimizedFormula.push({
      id,
      display_name: ing.display_name,
      inclusion,
      cost: ing.cost,
      cost_contribution: round4((inclusion / formulaBasis) * ing.cost),
      status: "used"
    });
  }

  return optimizedFormula;
}

// Proximate nutrients that often have no breed-standard target but DO exist in
// ingredient data.  We compute these after the LP solve so they appear in the
// optimized nutrient table even when the user hasn't constrained them.
const PROXIMATE_OBSERVATION_KEYS = [
  'dm', 'moisture', 'cf', 'ee', 'ash',
  'starch', 'sugars', 'ndf', 'adf', 'lignin',
  'nsp_total', 'nsp_sol', 'nsp_insol', 'beta_glucans', 'arabinoxylans'
];

const OBSERVATION_META_KEYS = new Set([
  'id', 'ingredient_id', 'name', 'display_name', 'ingredient_name',
  'price', 'cost', 'min', 'max', 'inclusion', 'min_inclusion', 'max_inclusion',
  'min_pct', 'max_pct', 'category', 'species', 'species_source', 'unit',
  'enabled', 'locked', 'included', 'price_basis', 'price_unit', 'source'
]);

// DM / moisture are mass fractions. Missing or zero user values must NOT
// fall back to library book values (that is what produced DM 89% next to
// moisture 12%). 0% DM is treated as "not entered".
function positivePct(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

/** User/payload only — never the species library. Pair always sums to 100. */
function resolveUserAsFedDmMoisture(ing) {
  if (!ing || typeof ing !== 'object') return null;
  const np = ing.nutrient_profile && typeof ing.nutrient_profile === 'object' ? ing.nutrient_profile : {};
  const moisture = positivePct(ing.moisture ?? ing.moisture_pct ?? np.moisture ?? np.moisture_pct);
  const dm = positivePct(ing.dm ?? ing.dm_pct ?? np.dm ?? np.dm_pct);
  if (moisture != null) {
    const m = Math.min(moisture, 99.9999);
    return { dm: round4(100 - m), moisture: round4(m) };
  }
  if (dm != null) {
    const d = Math.min(dm, 100);
    return { dm: round4(d), moisture: round4(100 - d) };
  }
  return null;
}

function computeFormulaDmMoisture(formula, ingredientsEnabledMap) {
  let dmTotal = 0;
  let moTotal = 0;
  let covered = 0;
  for (const row of (formula || [])) {
    const inclusion = toNumber(row.inclusion, 0);
    if (inclusion <= 0) continue;
    const payloadIng = ingredientsEnabledMap ? ingredientsEnabledMap[row.id] : null;
    const pair = resolveUserAsFedDmMoisture(payloadIng);
    if (!pair) continue;
    dmTotal += inclusion * pair.dm;
    moTotal += inclusion * pair.moisture;
    covered += inclusion;
  }
  if (covered <= 0) return null;
  return {
    dm: round4(dmTotal / covered),
    moisture: round4(moTotal / covered)
  };
}

function collectObservationKeys(formula, db, ingredientsEnabledMap) {
  const keys = new Set(PROXIMATE_OBSERVATION_KEYS);
  for (const row of (formula || [])) {
    const ingRecord = resolveIngredientRecord(db, row.id, row.display_name);
    const dbIng = (ingRecord && ingRecord.row) ? ingRecord.row : null;
    const payloadIng = ingredientsEnabledMap ? ingredientsEnabledMap[row.id] : null;
    for (const ing of [payloadIng, dbIng]) {
      if (!ing || typeof ing !== 'object') continue;
      for (const k of Object.keys(ing)) {
        if (OBSERVATION_META_KEYS.has(k) || k.startsWith('_')) continue;
        const n = Number(ing[k]);
        if (Number.isFinite(n)) keys.add(k);
      }
    }
  }
  return keys;
}

function computeObservationProfile(formula, db, basisValue, alreadyComputedKeys, ingredientsEnabledMap) {
  const skipSet = new Set(Array.isArray(alreadyComputedKeys) ? alreadyComputedKeys : []);
  const profile = {};
  const basis = toNumber(basisValue, 100) || 100;

  for (const nutrientKey of collectObservationKeys(formula, db, ingredientsEnabledMap)) {
    if (skipSet.has(nutrientKey)) continue;
    if (nutrientKey === 'dm' || nutrientKey === 'moisture' || nutrientKey === 'dm_pct' || nutrientKey === 'moisture_pct') continue;

    let total = 0;
    let covered = 0;
    let anyResolved = false;

    for (const row of (formula || [])) {
      const inclusion = toNumber(row.inclusion, 0);
      if (inclusion <= 0) continue;

      const ingRecord = resolveIngredientRecord(db, row.id, row.display_name);
      const dbIng = (ingRecord && ingRecord.row) ? ingRecord.row : null;
      const payloadIng = ingredientsEnabledMap ? ingredientsEnabledMap[row.id] : null;

      // Canonical profile lookup as final fallback when DB resolution fails
      const canonicalIng = (!dbIng && !payloadIng)
        ? matchIngredientToCanonical(row.display_name, row.id)
        : (!dbIng ? matchIngredientToCanonical(row.display_name, row.id) : null);

      if (!dbIng && !payloadIng && !canonicalIng) continue;

      // Prefer payload (Ingredient Intelligence / user-corrected) over DB, with canonical as last fallback
      const ingForVal = payloadIng || dbIng || canonicalIng;
      const ingForFallback = dbIng || canonicalIng || payloadIng;

      // Check raw key then _pct variant (matches analyzeFormula.cjs behaviour)
      let rawVal = ingForVal[nutrientKey];
      if (rawVal == null) rawVal = ingForVal[nutrientKey + '_pct'];
      // If payload didn't have it, try the DB record
      if ((rawVal == null || rawVal === '') && ingForFallback !== ingForVal) {
        rawVal = ingForFallback[nutrientKey];
        if (rawVal == null) rawVal = ingForFallback[nutrientKey + '_pct'];
      }

      let n = enteredNumber(rawVal);
      const nk = String(nutrientKey || '').toLowerCase();
      if (nk === 'me' || nk === 'amen' || nk === 'ne') {
        n = energyKcalFromIngredient(ingForVal, nk);
        if (!isFiniteNumber(n) || n === 0) n = energyKcalFromIngredient(ingForFallback, nk);
      } else if ((n == null || n === 0) && ingForFallback && ingForFallback !== ingForVal) {
        const fb = enteredNumber(ingForFallback[nutrientKey] ?? ingForFallback[nutrientKey + '_pct']);
        if (fb != null && fb > 0) n = fb;
      }
      if (n != null) {
        total += inclusion * n;
        covered += inclusion;
        anyResolved = true;
      }
    }

    if (!anyResolved || covered <= 0) continue;
    profile[nutrientKey] = round4(total / basis);
  }

  const dmMoist = computeFormulaDmMoisture(formula, ingredientsEnabledMap);
  if (dmMoist) {
    profile.dm = dmMoist.dm;
    profile.moisture = dmMoist.moisture;
  } else {
    delete profile.dm;
    delete profile.moisture;
  }

  return profile;
}

function calculateNutrientResultsFromFormula(optimizedFormula, nutrientMatrix, formulaBasis) {
  const results = {};
  const inclusions = {};

  optimizedFormula.forEach(row => {
    inclusions[row.id] = row.inclusion;
  });

  for (const nutrientKey of Object.keys(nutrientMatrix || {})) {
    let total = 0;
    const coeffs = nutrientMatrix[nutrientKey] || {};

    for (const [id, coeff] of Object.entries(coeffs)) {
      const inclusion = toNumber(inclusions[id], 0);
      total += inclusion * toNumber(coeff, 0);
    }

    results[nutrientKey] = round4(total / formulaBasis);
  }

  return results;
}

function evaluateConstraintSatisfaction(constraintsAll, nutrientResults) {
  return constraintsAll.map(c => {
    const actual = toNumber(nutrientResults?.[c.key], null);
    const hardness = normalizeKey(c.hardness || "hard");
    const bands = getConstraintBands(c.key);

    const tol = bands.numeric_tolerance;
    const warnBandBelow = toNumber(bands.warn_band_below, 0);
    const warnBandAbove = toNumber(bands.warn_band_above, 0);

    const min_ok_strict =
      !isFiniteNumber(c.min) || (isFiniteNumber(actual) && actual >= (c.min - tol));

    const max_ok_strict =
      !isFiniteNumber(c.max) || (isFiniteNumber(actual) && actual <= (c.max + tol));

    const min_warn_ok =
      !isFiniteNumber(c.min) ||
      (isFiniteNumber(actual) && actual >= (c.min - warnBandBelow));

    const max_warn_ok =
      !isFiniteNumber(c.max) ||
      (isFiniteNumber(actual) && actual <= (c.max + warnBandAbove));

    let status = "OK";

    if (min_ok_strict && max_ok_strict) {
      status = "OK";
    } else if (hardness === "soft") {
      status = "WARN";
    } else if (!min_ok_strict && min_warn_ok && max_ok_strict) {
      status = "WARN";
    } else {
      status = "FAIL";
    }

    return {
      nutrient: c.key,
      min: c.min,
      target: c.target,
      max: c.max,
      actual,
      numeric_tolerance_used: tol,
      warning_band_below_used: warnBandBelow,
      warning_band_above_used: warnBandAbove,
      min_ok: min_ok_strict,
      max_ok: max_ok_strict,
      min_warn_ok,
      max_warn_ok,
      status,
      hardness: c.hardness
    };
  });
}

function buildStartingFormulaMap(startingFormula) {
  const map = {};
  (Array.isArray(startingFormula) ? startingFormula : []).forEach(row => {
    if (!row?.id) return;
    map[row.id] = {
      id: row.id,
      display_name: row.display_name || row.id,
      inclusion: round4(toNumber(row.inclusion, 0))
    };
  });
  return map;
}

function applyPracticalControlsToIngredients(ingredientsEnabled, body) {
  const locked = Array.isArray(body.locked_ingredients) ? body.locked_ingredients : [];
  const excluded = Array.isArray(body.excluded_ingredients) ? body.excluded_ingredients : [];
  const maxMovement = body?.max_movement && typeof body.max_movement === "object" ? body.max_movement : {};
  const startingFormulaMap = buildStartingFormulaMap(body.starting_formula);

  const lockedMap = {};
  locked.forEach(row => {
    if (!row?.id) return;
    const val = toNumber(row.inclusion, null);
    if (isFiniteNumber(val)) {
      lockedMap[row.id] = round4(val);
    }
  });

  const excludedSet = new Set(excluded.map(x => String(x)));

  const adjusted = ingredientsEnabled.map(ing => {
    let adjustedMin = ing.min;
    let adjustedMax = ing.max;
    const notes = [];

    if (Object.prototype.hasOwnProperty.call(lockedMap, ing.id)) {
      adjustedMin = lockedMap[ing.id];
      adjustedMax = lockedMap[ing.id];
      notes.push("locked");
    } else if (excludedSet.has(ing.id)) {
      adjustedMin = 0;
      adjustedMax = 0;
      notes.push("excluded");
    } else if (
      Object.prototype.hasOwnProperty.call(maxMovement, ing.id) &&
      Object.prototype.hasOwnProperty.call(startingFormulaMap, ing.id)
    ) {
      const move = toNumber(maxMovement[ing.id], null);
      const start = toNumber(startingFormulaMap[ing.id].inclusion, null);

      if (isFiniteNumber(move) && move >= 0 && isFiniteNumber(start)) {
        adjustedMin = Math.max(ing.min, round4(start - move));
        adjustedMax = Math.min(ing.max, round4(start + move));
        notes.push("max_movement_applied");
      }
    }

    if (adjustedMin > adjustedMax) {
      adjustedMin = adjustedMax;
      notes.push("bounds_collapsed_after_controls");
    }

    return {
      ...ing,
      min: round4(adjustedMin),
      max: round4(adjustedMax),
      _practical_control_notes: notes
    };
  });

  const controlsAppliedToBounds = adjusted.map(ing => {
    const original = ingredientsEnabled.find(x => x.id === ing.id) || ing;
    return {
      id: ing.id,
      display_name: ing.display_name,
      original_min: original.min,
      original_max: original.max,
      adjusted_min: ing.min,
      adjusted_max: ing.max,
      notes: ing._practical_control_notes || []
    };
  });

  return {
    adjustedIngredients: adjusted.map(({ _practical_control_notes, ...rest }) => rest),
    practicalControls: {
      locked_ingredients: clone(locked),
      excluded_ingredients: clone(excluded),
      max_movement: clone(maxMovement),
      controls_applied_to_bounds: controlsAppliedToBounds
    }
  };
}

function isSoybeanMealIng(ing) {
  const n = `${ing?.id || ""} ${ing?.display_name || ""} ${ing?.name || ""}`.toLowerCase();
  return /soybean|soya/.test(n) && /meal/.test(n) && !/full-?fat|hull|oil/.test(n);
}

/** One soybean meal grade in the LP. Mills do not split 46.5% and 48% SBM in the same diet. */
function collapseDuplicateSoybeanMeals(ingredientsEnabled) {
  const sbm = (ingredientsEnabled || []).filter(isSoybeanMealIng);
  if (sbm.length <= 1) return ingredientsEnabled;
  const forced = sbm.filter((x) => toNumber(x.min, 0) > 0.05);
  const keepIds = new Set();
  if (forced.length) forced.forEach((x) => keepIds.add(x.id));
  else {
    const cheapest = [...sbm].sort((a, b) => {
      const dc = toNumber(a.cost, 99) - toNumber(b.cost, 99);
      return dc !== 0 ? dc : String(a.id).localeCompare(String(b.id));
    })[0];
    if (cheapest) keepIds.add(cheapest.id);
  }
  return (ingredientsEnabled || []).map((ing) => {
    if (!isSoybeanMealIng(ing) || keepIds.has(ing.id)) return ing;
    return { ...ing, max: 0 };
  });
}

function buildStartingFormulaComparison(startingFormula, optimizedFormula, ingredientsEnabled) {
  const hasStartingFormula = Array.isArray(startingFormula) && startingFormula.length > 0;
  const startMap = buildStartingFormulaMap(startingFormula);
  const optMap = {};
  (optimizedFormula || []).forEach(row => {
    optMap[row.id] = row;
  });

  const rows = ingredientsEnabled.map(ing => {
    const start = startMap[ing.id];
    const opt = optMap[ing.id];

    return {
      id: ing.id,
      display_name: ing.display_name,
      start_inclusion: round4(toNumber(start?.inclusion, 0)),
      optimized_inclusion: round4(toNumber(opt?.inclusion, 0)),
      delta_inclusion: round4(toNumber(opt?.inclusion, 0) - toNumber(start?.inclusion, 0)),
      start_cost: 0,
      optimized_cost: isFiniteNumber(opt?.cost) ? opt.cost : null
    };
  });

  return { has_starting_formula: hasStartingFormula, rows };
}

function buildInclusionDelta(startingFormulaComparison) {
  return (startingFormulaComparison?.rows || [])
    .map(row => ({
      id: row.id,
      display_name: row.display_name,
      start_inclusion: row.start_inclusion,
      optimized_inclusion: row.optimized_inclusion,
      delta_inclusion: row.delta_inclusion,
      direction:
        row.delta_inclusion > 0 ? "up" :
        row.delta_inclusion < 0 ? "down" : "same"
    }))
    .sort((a, b) => Math.abs(b.delta_inclusion) - Math.abs(a.delta_inclusion));
}

function calculateFormulaCostFromRows(rows, ingredientCostMap, formulaBasis) {
  return round4(sumBy(rows || [], row => {
    const inclusion = toNumber(row?.inclusion, 0);
    const cost = toNumber(ingredientCostMap[row?.id], 0);
    return (inclusion / formulaBasis) * cost;
  }));
}

function buildCostDelta(startingFormula, optimizedFormula, ingredientsEnabled, formulaBasis) {
  const ingredientCostMap = {};
  ingredientsEnabled.forEach(ing => {
    ingredientCostMap[ing.id] = ing.cost;
  });

  const startRows = Array.isArray(startingFormula) ? startingFormula : [];
  const optRows = Array.isArray(optimizedFormula) ? optimizedFormula : [];

  const startTotalCost = calculateFormulaCostFromRows(startRows, ingredientCostMap, formulaBasis);
  const optimizedTotalCost = calculateFormulaCostFromRows(optRows, ingredientCostMap, formulaBasis);

  return {
    start_total_cost_per_ton: startTotalCost,
    optimized_total_cost_per_ton: optimizedTotalCost,
    delta_cost_per_ton: round4(optimizedTotalCost - startTotalCost)
  };
}

function calculateNutrientResultsFromStartingFormula(startingFormula, nutrientMatrix, formulaBasis) {
  const normalized = (Array.isArray(startingFormula) ? startingFormula : []).map(row => ({
    id: row.id,
    inclusion: round4(toNumber(row.inclusion, 0))
  }));
  return calculateNutrientResultsFromFormula(normalized, nutrientMatrix, formulaBasis);
}

function buildNutrientDelta(startingFormula, optimizedFormula, nutrientMatrix, constraintsAll, formulaBasis) {
  const hasStartingFormula = Array.isArray(startingFormula) && startingFormula.length > 0;
  const startResults = hasStartingFormula
    ? calculateNutrientResultsFromStartingFormula(startingFormula, nutrientMatrix, formulaBasis)
    : {};
  const optimizedResults = calculateNutrientResultsFromFormula(optimizedFormula, nutrientMatrix, formulaBasis);

  return {
    has_starting_formula: hasStartingFormula,
    rows: constraintsAll.map(c => ({
      nutrient: c.key,
      start_actual: hasStartingFormula ? toNumber(startResults[c.key], null) : null,
      optimized_actual: toNumber(optimizedResults[c.key], null),
      delta: hasStartingFormula
        ? round4(toNumber(optimizedResults[c.key], 0) - toNumber(startResults[c.key], 0))
        : null,
      min: c.min,
      target: c.target,
      max: c.max
    }))
  };
}

function nutrientBindTol(key) {
  const k = normalizeKey(key);
  if (["me", "amen", "ne", "nel_mcal_kg", "nem_mcal_kg", "neg_mcal_kg"].includes(k)) return 5;
  if (k === "cp" || k === "tdn") return 0.03;
  if (k.startsWith("sid_") || k.startsWith("total_")) return 0.008;
  if (["ca", "avp", "na", "cl", "total_p", "p", "k", "mg"].includes(k)) return 0.005;
  return 0.02;
}

function shadowStepFor(key) {
  const k = normalizeKey(key);
  if (["me", "amen", "ne"].includes(k)) return 25;
  if (k === "cp" || k === "tdn") return 0.25;
  if (k.startsWith("sid_") || k.startsWith("total_")) return 0.05;
  if (["ca", "avp", "na", "cl", "total_p", "p"].includes(k)) return 0.05;
  return 0.1;
}

function buildBindingConstraints(constraintsAll, nutrientResults, tolerance = 0.001) {
  return constraintsAll
    .map(c => {
      const actual = toNumber(nutrientResults?.[c.key], null);
      const slackToMin = isFiniteNumber(c.min) && isFiniteNumber(actual) ? round4(actual - c.min) : null;
      const slackToMax = isFiniteNumber(c.max) && isFiniteNumber(actual) ? round4(c.max - actual) : null;
      const distanceToTarget = isFiniteNumber(c.target) && isFiniteNumber(actual) ? round4(actual - c.target) : null;
      const tol = nutrientBindTol(c.key);

      return {
        nutrient: c.key,
        binding_min: isFiniteNumber(slackToMin) ? slackToMin <= tol : false,
        binding_max: isFiniteNumber(slackToMax) ? slackToMax <= tol : false,
        near_target: isFiniteNumber(distanceToTarget) ? Math.abs(distanceToTarget) <= Math.max(tolerance, tol) : false,
        actual,
        min: c.min,
        target: c.target,
        max: c.max,
        slack_to_min: slackToMin,
        slack_to_max: slackToMax,
        distance_to_target: distanceToTarget
      };
    })
    .filter(row => row.binding_min || row.binding_max || row.near_target);
}

function buildNutrientSlack(constraintsAll, nutrientResults) {
  return constraintsAll.map(c => {
    const actual = toNumber(nutrientResults?.[c.key], null);
    return {
      nutrient: c.key,
      actual,
      min: c.min,
      target: c.target,
      max: c.max,
      slack_to_min: isFiniteNumber(c.min) && isFiniteNumber(actual) ? round4(actual - c.min) : null,
      slack_to_max: isFiniteNumber(c.max) && isFiniteNumber(actual) ? round4(c.max - actual) : null,
      distance_to_target: isFiniteNumber(c.target) && isFiniteNumber(actual) ? round4(actual - c.target) : null,
      hardness: c.hardness
    };
  });
}

function buildIngredientBoundStatus(ingredientsEnabled, optimizedFormula, tolerance = 0.0001) {
  const optMap = {};
  (optimizedFormula || []).forEach(row => {
    optMap[row.id] = row;
  });

  return ingredientsEnabled.map(ing => {
    const inclusion = round4(toNumber(optMap[ing.id]?.inclusion, 0));
    return {
      id: ing.id,
      display_name: ing.display_name,
      inclusion,
      min: ing.min,
      max: ing.max,
      cost: ing.cost,
      at_min: Math.abs(inclusion - ing.min) <= tolerance,
      at_max: Math.abs(inclusion - ing.max) <= tolerance,
      excluded: inclusion <= tolerance,
      slack_to_min: round4(inclusion - ing.min),
      slack_to_max: round4(ing.max - inclusion)
    };
  });
}

function buildOptimizationSummary({
  optimizedFormula,
  costSummary,
  bindingConstraints,
  ingredientBoundStatus,
  inclusionDelta
}) {
  const topBindingNutrients = (bindingConstraints || []).map(x => x.nutrient);

  const ingredientsAtMax = (ingredientBoundStatus || [])
    .filter(x => x.at_max)
    .map(x => x.id);

  const ingredientsAtMin = (ingredientBoundStatus || [])
    .filter(x => x.at_min)
    .map(x => x.id);

  const topMovedIngredients = (inclusionDelta || [])
    .filter(x => x.direction !== "same")
    .slice(0, 5)
    .map(x => ({
      id: x.id,
      delta_inclusion: x.delta_inclusion,
      direction: x.direction
    }));

  return {
    total_cost_per_ton: costSummary?.total_cost_per_ton ?? null,
    top_binding_nutrients: topBindingNutrients,
    ingredients_at_max: ingredientsAtMax,
    ingredients_at_min: ingredientsAtMin,
    top_moved_ingredients: topMovedIngredients
  };
}

function buildInfeasibilityDiagnostics({
  basisFeasibilityNotes,
  constraintSatisfaction,
  solverStatus,
  lpSolveAttempt,
  lpHardViolations = []
}) {
  const failedConstraints = (constraintSatisfaction || [])
    .filter(x => x.status === "FAIL")
    .map(x => ({
      nutrient: x.nutrient,
      actual: x.actual,
      min: x.min,
      target: x.target,
      max: x.max
    }));

  return {
    has_infeasibility: (basisFeasibilityNotes || []).length > 0 || failedConstraints.length > 0 || (lpHardViolations || []).length > 0,
    solver_status: solverStatus?.termination || null,
    lp_status: lpSolveAttempt?.status || null,
    notes: clone(basisFeasibilityNotes || []),
    failed_constraints: failedConstraints,
    lp_hard_violations: lpHardViolations || []
  };
}


function buildObjectiveBreakdownFromLpResult({
  lpRawResult,
  ingredientVariableIds,
  objectiveCostVector,
  formulaBasis
}) {
  const raw = lpRawResult || {};
  const ingredientIds = new Set(ingredientVariableIds || []);

  let ingredient_cost_component = 0;
  let deviation_penalty_component = 0;
  let movement_penalty_component = 0;

  const rows = [];

  for (const [id, cost] of Object.entries(objectiveCostVector || {})) {
    const value = toNumber(raw[id], 0);
    if (!isFiniteNumber(value) || Math.abs(value) <= 0.0000001) continue;

    const unitCost = toNumber(cost, 0);
    const contribution = round4(value * unitCost);

    let bucket = "other";
    if (ingredientIds.has(id)) {
      bucket = "ingredient";
      ingredient_cost_component += contribution;
    } else if (String(id).startsWith("dev_")) {
      bucket = "deviation_penalty";
      deviation_penalty_component += contribution;
    } else if (String(id).startsWith("move_")) {
      bucket = "movement_penalty";
      movement_penalty_component += contribution;
    }

    rows.push({
      id,
      bucket,
      variable_value: round4(value),
      unit_cost: unitCost,
      objective_contribution: contribution
    });
  }

  const total_objective_value = round4(
    ingredient_cost_component +
    deviation_penalty_component +
    movement_penalty_component
  );

  return {
    ingredient_cost_component: round4(ingredient_cost_component),
    deviation_penalty_component: round4(deviation_penalty_component),
    movement_penalty_component: round4(movement_penalty_component),
    total_objective_value,
    rows: rows.sort((a, b) => b.objective_contribution - a.objective_contribution)
  };
}

function buildPenaltyUsageDiagnostics({
  lpRawResult,
  objectiveCostVector
}) {
  const raw = lpRawResult || {};
  const rows = [];

  for (const [id, valueRaw] of Object.entries(raw)) {
    const value = toNumber(valueRaw, 0);
    if (!isFiniteNumber(value) || value <= 0.0000001) continue;

    if (!String(id).startsWith("dev_") && !String(id).startsWith("move_")) continue;

    const penalty = toNumber(objectiveCostVector?.[id], 0);
    const objective_contribution = round4(value * penalty);

    rows.push({
      id,
      category: String(id).startsWith("dev_") ? "deviation" : "movement",
      variable_value: round4(value),
      penalty,
      objective_contribution
    });
  }

  const deviation_rows = rows.filter(x => x.category === "deviation");
  const movement_rows = rows.filter(x => x.category === "movement");

  return {
    active_penalty_variables_count: rows.length,
    active_deviation_variables_count: deviation_rows.length,
    active_movement_variables_count: movement_rows.length,
    deviation_rows: deviation_rows.sort((a, b) => b.objective_contribution - a.objective_contribution),
    movement_rows: movement_rows.sort((a, b) => b.objective_contribution - a.objective_contribution)
  };
}

function buildEconomicDriverSummary({
  bindingConstraints,
  ingredientBoundStatus,
  inclusionDelta,
  objectiveBreakdownResult,
  penaltyUsage
}) {
  const top_binding_nutrients = (bindingConstraints || [])
    .slice(0, 10)
    .map(x => ({
      nutrient: x.nutrient,
      actual: x.actual,
      min: x.min,
      target: x.target,
      max: x.max,
      slack_to_min: x.slack_to_min,
      slack_to_max: x.slack_to_max,
      distance_to_target: x.distance_to_target
    }));

  const ingredients_at_max = (ingredientBoundStatus || [])
    .filter(x => x.at_max)
    .sort((a, b) => b.inclusion - a.inclusion)
    .slice(0, 10)
    .map(x => ({
      id: x.id,
      inclusion: x.inclusion,
      max: x.max,
      slack_to_max: x.slack_to_max
    }));

  const ingredients_at_min = (ingredientBoundStatus || [])
    .filter(x => x.at_min)
    .sort((a, b) => b.inclusion - a.inclusion)
    .slice(0, 10)
    .map(x => ({
      id: x.id,
      inclusion: x.inclusion,
      min: x.min,
      slack_to_min: x.slack_to_min
    }));

  const top_moved_ingredients = (inclusionDelta || [])
    .filter(x => x.direction !== "same")
    .slice(0, 10);

  const top_objective_contributors = (objectiveBreakdownResult?.rows || [])
    .slice(0, 15);

  const top_penalty_drivers = [
    ...((penaltyUsage?.deviation_rows || []).slice(0, 10)),
    ...((penaltyUsage?.movement_rows || []).slice(0, 10))
  ].sort((a, b) => b.objective_contribution - a.objective_contribution).slice(0, 10);

  return {
    top_binding_nutrients,
    ingredients_at_max,
    ingredients_at_min,
    top_moved_ingredients,
    top_objective_contributors,
    top_penalty_drivers
  };
}

function buildObjectiveBreakdownPerTon(objectiveBreakdownResult, formulaBasis) {
  const basis = toNumber(formulaBasis, 100);
  const safeBasis = basis > 0 ? basis : 100;

  const ingredientRaw = toNumber(objectiveBreakdownResult?.ingredient_cost_component, 0);
  const deviationRaw = toNumber(objectiveBreakdownResult?.deviation_penalty_component, 0);
  const movementRaw = toNumber(objectiveBreakdownResult?.movement_penalty_component, 0);
  const totalRaw = toNumber(objectiveBreakdownResult?.total_objective_value, 0);

  return {
    basis: safeBasis,
    ingredient_cost_component_per_ton: round4(ingredientRaw / safeBasis),
    deviation_penalty_component_per_ton: round4(deviationRaw / safeBasis),
    movement_penalty_component_per_ton: round4(movementRaw / safeBasis),
    total_objective_value_per_ton: round4(totalRaw / safeBasis)
  };
}

function buildIngredientMovementReasonEngine({
  inclusionDelta,
  ingredientBoundStatus,
  bindingConstraints,
  penaltyUsage,
  nutrientSlack
}) {
  const atMaxSet = new Set(
    (ingredientBoundStatus || []).filter(x => x.at_max).map(x => x.id)
  );

  const atMinSet = new Set(
    (ingredientBoundStatus || []).filter(x => x.at_min).map(x => x.id)
  );

  const topBinding = (bindingConstraints || []).map(x => x.nutrient);
  const activePenaltyIds = new Set(
    ((penaltyUsage?.movement_rows || []).map(x => x.id))
  );

  function inferReason(row) {
    const reasons = [];
    const id = row.id || "";
    const idNorm = normalizeKey(id);
    const delta = toNumber(row.delta_inclusion, 0);

    if (delta > 0) {
      if (["sbm_48", "soybean_meal_48_cp", "soybean_meal"].includes(idNorm)) {
        reasons.push("protein_or_amino_acid_support");
      }
      if (["l_lys_hcl"].includes(idNorm)) reasons.push("lysine_support");
      if (["dl_met"].includes(idNorm)) reasons.push("methionine_support");
      if (["l_thr"].includes(idNorm)) reasons.push("threonine_support");
      if (["dcp"].includes(idNorm)) reasons.push("available_phosphorus_or_calcium_support");
      if (["limestone"].includes(idNorm)) reasons.push("calcium_support");
      if (["salt", "sodium_bicarbonate"].includes(idNorm)) reasons.push("sodium_or_chloride_support");
      if (["corn"].includes(idNorm)) reasons.push("energy_or_least_cost_balance");
      if (["oil"].includes(idNorm)) reasons.push("energy_density_support");
    }

    if (delta < 0) {
      if (["oil"].includes(idNorm)) reasons.push("reduced_high_cost_energy");
      if (["salt"].includes(idNorm)) reasons.push("electrolyte_rebalance");
      if (["limestone"].includes(idNorm)) reasons.push("calcium_rebalance");
    }

    if (atMaxSet.has(id)) reasons.push("hit_max_inclusion");
    if (atMinSet.has(id)) reasons.push("hit_min_inclusion");

    const moveUpId = `move_up__${idNorm}`;
    const moveDownId = `move_down__${idNorm}`;
    if (activePenaltyIds.has(moveUpId) || activePenaltyIds.has(moveDownId)) {
      reasons.push("movement_penalty_active");
    }

    if (topBinding.includes("cp") || topBinding.includes("sid_lys") || topBinding.includes("sid_metcys") || topBinding.includes("sid_thr")) {
      if (delta > 0 && ["sbm_48", "l_lys_hcl", "dl_met", "l_thr"].includes(idNorm)) {
        reasons.push("binding_amino_acid_or_protein_constraint");
      }
    }

    if (topBinding.includes("avp") || topBinding.includes("ca")) {
      if (delta > 0 && ["dcp", "limestone"].includes(idNorm)) {
        reasons.push("binding_mineral_constraint");
      }
    }

    if (topBinding.includes("na") || topBinding.includes("cl")) {
      if (["salt", "sodium_bicarbonate"].includes(idNorm)) {
        reasons.push("binding_electrolyte_constraint");
      }
    }

    if (topBinding.includes("me")) {
      if (["corn", "oil"].includes(idNorm)) {
        reasons.push("energy_constraint_pressure");
      }
    }

    return [...new Set(reasons)];
  }

  return {
    rows: (inclusionDelta || [])
      .filter(x => x.direction !== "same")
      .map(row => ({
        id: row.id,
        display_name: row.display_name,
        start_inclusion: row.start_inclusion,
        optimized_inclusion: row.optimized_inclusion,
        delta_inclusion: row.delta_inclusion,
        direction: row.direction,
        inferred_reasons: inferReason(row)
      }))
      .sort((a, b) => Math.abs(b.delta_inclusion) - Math.abs(a.delta_inclusion))
  };
}

function buildEconomicPressureSummary({
  objectiveBreakdownPerTon,
  penaltyUsage,
  economicDriverSummary,
  bindingConstraints,
  ingredientBoundStatus
}) {
  const ingredient_cost_per_ton = toNumber(objectiveBreakdownPerTon?.ingredient_cost_component_per_ton, 0);
  const deviation_penalty_per_ton = toNumber(objectiveBreakdownPerTon?.deviation_penalty_component_per_ton, 0);
  const movement_penalty_per_ton = toNumber(objectiveBreakdownPerTon?.movement_penalty_component_per_ton, 0);
  const total_objective_per_ton = toNumber(objectiveBreakdownPerTon?.total_objective_value_per_ton, 0);

  const top_penalty_drivers = (economicDriverSummary?.top_penalty_drivers || []).slice(0, 5);
  const top_binding_nutrients = (economicDriverSummary?.top_binding_nutrients || []).slice(0, 5);
  const ingredients_at_max = (economicDriverSummary?.ingredients_at_max || []).slice(0, 5);
  const ingredients_at_min = (economicDriverSummary?.ingredients_at_min || []).slice(0, 5);
  const top_objective_contributors = (economicDriverSummary?.top_objective_contributors || []).slice(0, 5);

  let dominant_pressure = "ingredient_cost";
  if (deviation_penalty_per_ton >= movement_penalty_per_ton && deviation_penalty_per_ton > 0) {
    dominant_pressure = "deviation_penalty";
  } else if (movement_penalty_per_ton > deviation_penalty_per_ton && movement_penalty_per_ton > 0) {
    dominant_pressure = "movement_penalty";
  }

  return {
    ingredient_cost_per_ton,
    deviation_penalty_per_ton,
    movement_penalty_per_ton,
    total_objective_per_ton,
    dominant_pressure,
    active_deviation_variables_count: toNumber(penaltyUsage?.active_deviation_variables_count, 0),
    active_movement_variables_count: toNumber(penaltyUsage?.active_movement_variables_count, 0),
    top_penalty_drivers,
    top_binding_nutrients,
    ingredients_at_max,
    ingredients_at_min,
    top_objective_contributors
  };
}

function buildGainObjectiveMetrics(context, costSummary, trueLp = false) {
  const objective = context.objective;
  const gainData = context.gain_data;

  if (objective === "least_cost" || !gainData) {
    return { available: false, objective, notes: ["No gain data supplied or objective is least_cost."] };
  }

  const totalCostPerTon = toNumber(costSummary?.total_cost_per_ton, null);
  if (!isFiniteNumber(totalCostPerTon)) {
    return { available: false, objective, notes: ["total_cost_per_ton unavailable."] };
  }

  const fcr         = gainData.fcr;
  const dailyGain   = gainData.daily_gain;
  const productPrice = gainData.product_price;
  const milkYield   = gainData.milk_yield;
  const dfi         = gainData.daily_feed_intake;
  // total_cost_per_ton is actually $/kg (see comment in original code)
  const costPerKgFeed = totalCostPerTon;

  let costPerUnitGain = null;
  if (isFiniteNumber(fcr) && fcr > 0) {
    costPerUnitGain = round4(costPerKgFeed * fcr);
  }

  let profitPerKgFeed = null;
  let iofcPerDay = null;
  const sp = normalizeSpecies(context.species);

  if (isFiniteNumber(productPrice)) {
    if (objective === "iofc" && sp === "dairy" && isFiniteNumber(milkYield) && isFiniteNumber(dfi) && dfi > 0) {
      // IOFC for dairy: revenue = milk_yield × milk_price; cost = DFI × feed_cost_per_kg
      const revenuePerDay = milkYield * productPrice;
      const feedCostPerDay = dfi * costPerKgFeed;
      iofcPerDay = round4(revenuePerDay - feedCostPerDay);
      profitPerKgFeed = round4(iofcPerDay / dfi);
    } else if (isFiniteNumber(fcr) && fcr > 0) {
      // Meat / generic: IOFC = (product_price/FCR) − feed_cost_per_kg
      profitPerKgFeed = round4((productPrice / fcr) - costPerKgFeed);
    } else if (isFiniteNumber(dailyGain) && dailyGain > 0) {
      profitPerKgFeed = round4((productPrice * dailyGain) - costPerKgFeed);
    }
  }

  const isTrueLp = trueLp === true;
  return {
    available: true,
    objective,
    true_lp_objective: isTrueLp,
    inputs: {
      fcr: fcr ?? null,
      daily_gain: dailyGain ?? null,
      product_price: productPrice ?? null,
      milk_yield: milkYield ?? null,
      daily_feed_intake: dfi ?? null,
    },
    cost_per_kg_feed: round4(costPerKgFeed),
    cost_per_unit_gain: costPerUnitGain,
    profit_per_kg_feed: profitPerKgFeed,
    profit_per_ton: isFiniteNumber(profitPerKgFeed) ? round4(profitPerKgFeed * 1000) : null,
    iofc_per_cow_per_day: iofcPerDay,
    notes: [
      isTrueLp
        ? "Nutrient-revenue LP is on. The mix can differ from least-cost. IOFC still uses your farm FCR/milk/price × true feed cost. Not CNCPS."
        : "Least-cost LP. IOFC and cost/gain are accounting identities from farm FCR/milk/prices × optimized feed cost. Not CNCPS.",
    ],
  };
}

function profitFromFeedCost(context, costPerKgFeed) {
  const gainData = context.gain_data || {};
  const fcr = toNumber(gainData.fcr, null);
  const productPrice = toNumber(gainData.product_price, null);
  const milkYield = toNumber(gainData.milk_yield, null);
  const dfi = toNumber(gainData.daily_feed_intake, null);
  const dailyGain = toNumber(gainData.daily_gain, null);
  const sp = normalizeSpecies(context.species);
  let profitPerKgFeed = null;
  let iofcPerDay = null;
  if (isFiniteNumber(productPrice)) {
    if (context.objective === "iofc" && sp === "dairy" && isFiniteNumber(milkYield) && isFiniteNumber(dfi) && dfi > 0) {
      iofcPerDay = round4(milkYield * productPrice - dfi * costPerKgFeed);
      profitPerKgFeed = round4(iofcPerDay / dfi);
    } else if (isFiniteNumber(fcr) && fcr > 0) {
      profitPerKgFeed = round4((productPrice / fcr) - costPerKgFeed);
    } else if (isFiniteNumber(dailyGain) && dailyGain > 0) {
      profitPerKgFeed = round4((productPrice * dailyGain) - costPerKgFeed);
    }
  }
  return {
    cost_per_kg: round4(costPerKgFeed),
    profit_per_kg_feed: profitPerKgFeed,
    profit_per_ton: isFiniteNumber(profitPerKgFeed) ? round4(profitPerKgFeed * 1000) : null,
    iofc_per_cow_per_day: iofcPerDay,
  };
}

async function buildProfitCompare({
  javascriptLpModel,
  ingredientCostVector,
  ingredientVariableIds,
  ingredientsEnabled,
  formulaBasis,
  profitFormula,
  profitCostPerKg,
  context,
}) {
  const lcModel = clone(javascriptLpModel);
  for (const id of ingredientVariableIds || []) {
    if (lcModel.variables?.[id]) {
      lcModel.variables[id].cost = toNumber(ingredientCostVector?.[id], 0);
    }
  }
  const lcSolve = await solveWithJavascriptLp(lcModel);
  const infeasible = !lcSolve?.ok || lcSolve?.result?.feasible === false || lcSolve?.result?.result === "Infeasible";
  if (infeasible) {
    return { available: false, note: "Least-cost comparison solve was infeasible." };
  }
  const lcFormula = buildOptimizedFormulaFromLpResult(
    ingredientVariableIds,
    ingredientsEnabled,
    lcSolve.result,
    formulaBasis
  );
  const lcCost = round4(sumBy(lcFormula, x => x.cost_contribution));
  const profitById = {};
  for (const row of profitFormula || []) profitById[row.id] = row;
  const lcById = {};
  for (const row of lcFormula || []) lcById[row.id] = row;
  const ids = [...new Set([...Object.keys(profitById), ...Object.keys(lcById)])];
  const mix_changes = ids.map(id => {
    const p = profitById[id];
    const l = lcById[id];
    const name = (p || l)?.display_name || id;
    const profit_pct = round4(p?.inclusion || 0);
    const least_pct = round4(l?.inclusion || 0);
    return {
      id,
      display_name: name,
      least_cost_pct: least_pct,
      profit_pct,
      delta_pct: round4(profit_pct - least_pct),
    };
  }).filter(r => Math.abs(r.delta_pct) >= 0.05 || r.profit_pct >= 0.05 || r.least_cost_pct >= 0.05)
    .sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct));

  const profitEcon = profitFromFeedCost(context, profitCostPerKg);
  const lcEcon = profitFromFeedCost(context, lcCost);
  return {
    available: true,
    least_cost: { ...lcEcon, mix: lcFormula },
    max_profit: { ...profitEcon, mix: profitFormula },
    extra_feed_cost_per_ton: round4((profitCostPerKg - lcCost) * 1000),
    extra_profit_per_ton: isFiniteNumber(profitEcon.profit_per_ton) && isFiniteNumber(lcEcon.profit_per_ton)
      ? round4(profitEcon.profit_per_ton - lcEcon.profit_per_ton)
      : null,
    mix_changes,
    note: "Same constraints. Least-cost uses raw ingredient prices. Max-profit / IOFC credits species nutrient revenue, then IOFC uses your farm FCR or milk × true feed cost.",
  };
}

function buildConstraintSensitivityCases(constraintsAll) {
  const cases = [];

  for (const c of constraintsAll || []) {
    const k = normalizeKey(c.key);

    let step = 0.01;
    if (["me", "amen", "ne"].includes(k)) step = 5;
    else if (["cp"].includes(k)) step = 0.1;
    else if (["ca", "avp"].includes(k)) step = 0.01;
    else if (["na", "cl"].includes(k)) step = 0.005;
    else if (k.startsWith("sid_") || k.startsWith("total_")) step = 0.01;

    if (isFiniteNumber(c.min)) {
      cases.push({
        nutrient: c.key,
        side: "min",
        direction: "tighten",
        delta: step,
        base_value: c.min,
        test_value: round4(c.min + step),
        hardness: c.hardness
      });
    }

    if (isFiniteNumber(c.max)) {
      cases.push({
        nutrient: c.key,
        side: "max",
        direction: "tighten",
        delta: step,
        base_value: c.max,
        test_value: round4(c.max - step),
        hardness: c.hardness
      });
    }
  }

  return cases;
}

function buildConstraintSensitivitySummary({
  baseObjectivePerTon,
  constraintSatisfaction,
  economicPressureSummary
}) {
  const baseObjective = toNumber(baseObjectivePerTon?.total_objective_value_per_ton, null);

  const candidate_constraints = (constraintSatisfaction || [])
    .filter(x => x.status === "OK" || x.status === "WARN")
    .map(x => ({
      nutrient: x.nutrient,
      min: x.min,
      max: x.max,
      actual: x.actual,
      hardness: x.hardness
    }));

  return {
    enabled: true,
    method: "finite_difference_preparation",
    base_objective_per_ton: baseObjective,
    dominant_pressure: economicPressureSummary?.dominant_pressure || null,
    candidate_constraints
  };
}

function buildSelectedSensitivityCases(constraintSensitivityCases) {
  // Every spec constraint on the open formula (min and max), not a poultry-9 allowlist.
  const list = Array.isArray(constraintSensitivityCases) ? constraintSensitivityCases : [];
  const MAX = 80;
  return list.slice(0, MAX);
}

async function runSensitivityPerturbationPass({
  selectedCases,
  constraintsAll,
  context,
  ingredientVariableIds,
  ingredientsEnabled,
  nutrientMatrix,
  ingredientBoundsMap,
  basisConstraint,
  objectiveBuild
}) {
  const rows = [];

  for (const sCase of selectedCases || []) {
    const testConstraints = (constraintsAll || []).map(c => {
      if (normalizeKey(c.key) !== normalizeKey(sCase.nutrient)) return { ...c };
      return {
        ...c,
        min: sCase.side === "min" ? sCase.test_value : c.min,
        max: sCase.side === "max" ? sCase.test_value : c.max
      };
    });

    const testDeviationBuild = buildDeviationVariables({
      constraintsAll: testConstraints,
      nutrientMatrix,
      formulaBasis: context.formula_basis,
      penalties: context.penalties
    });

    const testSolverReadyConstraints = [
      ...testDeviationBuild.solver_rows
    ];

    const testObjectiveCostVector = {
      ...(objectiveBuild?.objective_cost_vector || {}),
      ...(testDeviationBuild.variable_objective_map || {})
    };

    const testVariableBoundsMap = {
      ...ingredientBoundsMap,
      ...(testDeviationBuild.variable_bounds_map || {})
    };

    const testAllVariableIds = Array.from(new Set([
      ...(ingredientVariableIds || []),
      ...Object.keys(testDeviationBuild.variable_bounds_map || {})
    ]));

    const testJavascriptLpModel = buildJavascriptLpModel({
      allVariableIds: testAllVariableIds,
      objectiveCostVector: testObjectiveCostVector,
      variableBoundsMap: testVariableBoundsMap,
      basisConstraint,
      solverReadyConstraints: testSolverReadyConstraints
    });

    const solve = await solveWithJavascriptLp(testJavascriptLpModel);

    const lpExplicitlyInfeasible =
      solve?.result?.feasible === false ||
      solve?.result?.result === "Infeasible";

    const lpHasNumericObjective =
      isFiniteNumber(toNumber(solve?.result?.result, null));

    const lpHasDecisionValues =
      !!solve?.result &&
      (ingredientVariableIds || []).some(id => isFiniteNumber(toNumber(solve.result[id], null)));

    const feasible =
      !!solve?.ok &&
      !!solve?.result &&
      !lpExplicitlyInfeasible &&
      (lpHasNumericObjective || lpHasDecisionValues);

    let testObjectivePerTon = null;
    let testIngredientCostPerTon = null;

    if (feasible) {
      const rawObjective = toNumber(solve?.result?.result, null);
      if (isFiniteNumber(rawObjective) && isFiniteNumber(context.formula_basis) && context.formula_basis > 0) {
        testObjectivePerTon = round4(rawObjective / context.formula_basis);
      }

      testIngredientCostPerTon = calculateIngredientCostPerTonFromLpResult({
        lpRawResult: solve?.result,
        ingredientVariableIds,
        objectiveCostVector: objectiveBuild?.objective_cost_vector || {},
        formulaBasis: context.formula_basis
      });
    }

    rows.push({
      nutrient: sCase.nutrient,
      side: sCase.side,
      direction: sCase.direction,
      delta: sCase.delta,
      base_value: sCase.base_value,
      test_value: sCase.test_value,
      solve_status: feasible ? "optimal_or_feasible" : "failed_or_infeasible",
      test_objective_per_ton: testObjectivePerTon,
      test_ingredient_cost_per_ton: testIngredientCostPerTon
    });
  }

  return { rows };
}

async function resolveSensitivityModel({
  testConstraints,
  nutrientMatrix,
  context,
  ingredientVariableIds,
  ingredientBoundsMap,
  basisConstraint,
  objectiveBuild,
  extraSolverRows
}) {
  const testDeviationBuild = buildDeviationVariables({
    constraintsAll: testConstraints,
    nutrientMatrix,
    formulaBasis: context.formula_basis,
    penalties: context.penalties
  });
  const testObjectiveCostVector = {
    ...(objectiveBuild?.objective_cost_vector || {}),
    ...(testDeviationBuild.variable_objective_map || {})
  };
  const testVariableBoundsMap = {
    ...ingredientBoundsMap,
    ...(testDeviationBuild.variable_bounds_map || {})
  };
  const testAllVariableIds = Array.from(new Set([
    ...(ingredientVariableIds || []),
    ...Object.keys(testDeviationBuild.variable_bounds_map || {}),
    ...Object.keys(objectiveBuild?.objective_cost_vector || {})
  ]));
  const model = buildJavascriptLpModel({
    allVariableIds: testAllVariableIds,
    objectiveCostVector: testObjectiveCostVector,
    variableBoundsMap: testVariableBoundsMap,
    basisConstraint,
    solverReadyConstraints: [
      ...testDeviationBuild.solver_rows,
      ...(extraSolverRows || [])
    ]
  });
  const solve = await solveWithJavascriptLp(model);
  const lpExplicitlyInfeasible =
    solve?.result?.feasible === false ||
    solve?.result?.result === "Infeasible";
  const rawObjective = toNumber(solve?.result?.result ?? solve?.result?.cost, null);
  const feasible = !!solve?.ok && !!solve?.result && !lpExplicitlyInfeasible;
  const testIngredientCost = feasible
    ? calculateIngredientCostPerTonFromLpResult({
        lpRawResult: solve?.result,
        ingredientVariableIds,
        objectiveCostVector: testObjectiveCostVector,
        formulaBasis: context.formula_basis
      })
    : null;
  const testObjective = feasible && isFiniteNumber(rawObjective) && context.formula_basis > 0
    ? round4(rawObjective / context.formula_basis)
    : null;
  return { feasible, testIngredientCost, testObjective };
}

/** Binding-only shadows: relax a tight spec and measure $/ton. Slack specs stay 0 with a note. */
async function computeNutrientShadowPrices({
  constraintsAll,
  nutrientResults,
  context,
  ingredientVariableIds,
  nutrientMatrix,
  ingredientBoundsMap,
  basisConstraint,
  objectiveBuild,
  extraSolverRows,
  baseIngredientCostPerUnit,
  lpRawResult
}) {
  const exactBase = lpRawResult
    ? calculateIngredientCostPerTonFromLpResult({
        lpRawResult,
        ingredientVariableIds,
        objectiveCostVector: objectiveBuild?.objective_cost_vector || {},
        formulaBasis: context.formula_basis
      })
    : baseIngredientCostPerUnit;
  const baseTon = isFiniteNumber(exactBase) ? perFeedUnitToPerTon(exactBase, context.weight_unit) : null;
  const noiseTon = Math.max(0.02, Math.abs(baseTon || 0) * 1e-5);
  const maxDeltaTon = Math.max(25, Math.abs(baseTon || 0) * 0.15);

  const duals = lpRawResult && lpRawResult.duals && typeof lpRawResult.duals === "object"
    ? lpRawResult.duals
    : null;
  if (duals) {
    const rowsFromDuals = [];
    for (const c of constraintsAll || []) {
      const actual = toNumber(nutrientResults?.[c.key], null);
      const tol = nutrientBindTol(c.key);
      const slackMin = isFiniteNumber(c.min) && isFiniteNumber(actual) ? round4(actual - c.min) : null;
      const slackMax = isFiniteNumber(c.max) && isFiniteNumber(actual) ? round4(c.max - actual) : null;
      const bindMin = slackMin != null && slackMin <= tol;
      const bindMax = slackMax != null && slackMax <= tol;
      const step = shadowStepFor(c.key);
      const sides = [];
      if (isFiniteNumber(c.min)) sides.push({ side: "min", binding: bindMin, slack: slackMin, base: c.min });
      if (isFiniteNumber(c.max)) sides.push({ side: "max", binding: bindMax, slack: slackMax, base: c.max });
      for (const s of sides) {
        const dual = dualForConstraint(duals, c.key, s.side);
        const perTon = s.binding && isFiniteNumber(dual)
          ? perFeedUnitToPerTon(Math.abs(dual), context.weight_unit)
          : null;
        rowsFromDuals.push({
          nutrient: c.key,
          side: s.side,
          direction: s.binding ? (s.side === "min" ? "relax_min" : "relax_max") : "none",
          delta: step,
          base_value: s.base,
          test_value: s.base,
          actual,
          slack: s.slack,
          binding: s.binding,
          note: s.binding ? "HiGHS dual (same solve)" : `not binding; slack ${s.slack == null ? "—" : s.slack}`,
          solve_status: s.binding ? "dual" : "not_binding",
          test_objective_per_ton: exactBase,
          test_ingredient_cost_per_ton: exactBase,
          delta_objective_per_ton: perTon,
          marginal_cost_estimate: perTon
        });
      }
    }
    return { rows: rowsFromDuals, source: "highs_duals" };
  }

  const rows = [];
  for (const c of constraintsAll || []) {
    const actual = toNumber(nutrientResults?.[c.key], null);
    const tol = nutrientBindTol(c.key);
    const slackMin = isFiniteNumber(c.min) && isFiniteNumber(actual) ? round4(actual - c.min) : null;
    const slackMax = isFiniteNumber(c.max) && isFiniteNumber(actual) ? round4(c.max - actual) : null;
    const bindMin = slackMin != null && slackMin <= tol;
    const bindMax = slackMax != null && slackMax <= tol;
    const step = shadowStepFor(c.key);

    const sides = [];
    if (isFiniteNumber(c.min)) sides.push({ side: "min", binding: bindMin, slack: slackMin, base: c.min });
    if (isFiniteNumber(c.max)) sides.push({ side: "max", binding: bindMax, slack: slackMax, base: c.max });

    for (const s of sides) {
      if (!s.binding) {
        rows.push({
          nutrient: c.key,
          side: s.side,
          direction: "none",
          delta: step,
          base_value: s.base,
          test_value: s.base,
          actual,
          slack: s.slack,
          binding: false,
          note: `not binding; slack ${s.slack == null ? "—" : s.slack}`,
          solve_status: "not_binding",
          test_objective_per_ton: exactBase,
          test_ingredient_cost_per_ton: exactBase,
          delta_objective_per_ton: 0,
          marginal_cost_estimate: null
        });
        continue;
      }

      const testConstraints = (constraintsAll || []).map(row => {
        if (normalizeKey(row.key) !== normalizeKey(c.key)) return { ...row };
        if (s.side === "min") return { ...row, min: round4(row.min - step) };
        return { ...row, max: round4(row.max + step) };
      });

      const solved = await resolveSensitivityModel({
        testConstraints,
        nutrientMatrix,
        context,
        ingredientVariableIds,
        ingredientBoundsMap,
        basisConstraint,
        objectiveBuild,
        extraSolverRows
      });

      const testUnit = solved.feasible ? solved.testIngredientCost : null;
      const deltaUnit = isFiniteNumber(testUnit) && isFiniteNumber(exactBase)
        ? testUnit - exactBase
        : null;
      const deltaTon = isFiniteNumber(deltaUnit) ? perFeedUnitToPerTon(deltaUnit, context.weight_unit) : null;

      // Relaxing a binding bound must cheapen the mix. Reject wobble, rounding noise, and wrong sign.
      let shadow = null;
      let note = "binding";
      if (!solved.feasible) {
        note = "binding; re-solve failed";
      } else if (!isFiniteNumber(deltaTon) || !step) {
        note = "at spec; cost change not measurable";
      } else if (Math.abs(deltaTon) < noiseTon) {
        note = "at spec; relaxing it did not change cost";
      } else if (deltaTon > 0) {
        note = "at spec; cost move was noise (wrong sign)";
      } else if (Math.abs(deltaTon) > maxDeltaTon) {
        note = "at spec; cost move was implausible";
      } else {
        const rawShadow = (-deltaTon) / step;
        if (isFiniteNumber(rawShadow) && rawShadow > 0) {
          shadow = round4(rawShadow);
          note = "binding";
        } else {
          note = "at spec; cost move was noise";
        }
      }

      rows.push({
        nutrient: c.key,
        side: s.side,
        direction: "relax",
        delta: step,
        base_value: s.base,
        test_value: s.side === "min" ? round4(s.base - step) : round4(s.base + step),
        actual,
        slack: s.slack,
        binding: true,
        note,
        solve_status: solved.feasible ? "optimal_or_feasible" : "failed_or_infeasible",
        test_objective_per_ton: solved.testObjective,
        test_ingredient_cost_per_ton: testUnit,
        delta_objective_per_ton: deltaTon,
        marginal_cost_estimate: shadow
      });
    }
  }
  return { rows };
}

/**
 * Ingredient-level shadow prices: for each ingredient sitting at its min or max
 * bound, estimate how much the ration cost would decrease if the binding bound
 * were relaxed by PERTURBATION_PCT percentage-points. One LP re-solve per
 * binding ingredient — typically 2-5 extra solves, each < 30 ms.
 */
async function computeIngredientShadowPrices({
  ingredientBoundStatus,
  constraintsAll,
  context,
  ingredientVariableIds,
  ingredientsEnabled,
  nutrientMatrix,
  ingredientBoundsMap,
  basisConstraint,
  objectiveBuild,
  baseObjectivePerTon,
  lpRawResult
}) {
  const PERTURBATION_PCT = 1.0; // relax bound by 1 percentage-point
  const results = [];
  const reduced = lpRawResult && lpRawResult.reduced_costs && typeof lpRawResult.reduced_costs === "object"
    ? lpRawResult.reduced_costs
    : null;
  if (reduced) {
    const bindingIngredients = (ingredientBoundStatus || []).filter(ing =>
      ing.at_max || (ing.at_min && (ing.min ?? 0) > 0)
    );
    for (const ingStatus of bindingIngredients) {
      const isAtMax = ingStatus.at_max;
      const rc = toNumber(reduced[ingStatus.id], null);
      if (!isFiniteNumber(rc)) continue;
      const savingsPerTon = perFeedUnitToPerTon(Math.abs(rc) / 100, context.weight_unit);
      results.push({
        id: ingStatus.id,
        display_name: ingStatus.display_name,
        inclusion: ingStatus.inclusion,
        min: ingStatus.min,
        max: ingStatus.max,
        shadow_price_direction: isAtMax ? "up" : "down",
        shadow_price_per_unit: Math.abs(rc),
        shadow_price_unit: isAtMax ? "per 1% increase in Max" : "per 1% decrease in Min",
        estimated_savings_per_ton: savingsPerTon
      });
    }
    return results;
  }

  const bindingIngredients = (ingredientBoundStatus || []).filter(ing =>
    ing.at_max || (ing.at_min && (ing.min ?? 0) > 0)
  );

  for (const ingStatus of bindingIngredients) {
    const ingId = ingStatus.id;
    const isAtMax = ingStatus.at_max;
    const origBounds = ingredientBoundsMap[ingId] || {};

    if (isAtMax && origBounds.max == null) continue;
    if (!isAtMax && origBounds.min == null) continue;

    // Perturb the binding bound
    const testBoundsMap = { ...ingredientBoundsMap };
    if (isAtMax) {
      testBoundsMap[ingId] = { ...origBounds, max: origBounds.max + PERTURBATION_PCT };
    } else {
      testBoundsMap[ingId] = { ...origBounds, min: Math.max(0, origBounds.min - PERTURBATION_PCT) };
    }

    const testDeviationBuild = buildDeviationVariables({
      constraintsAll,
      nutrientMatrix,
      formulaBasis: context.formula_basis,
      penalties: context.penalties
    });

    const testAllVarIds = Array.from(new Set([
      ...ingredientVariableIds,
      ...Object.keys(testDeviationBuild.variable_bounds_map || {})
    ]));

    const testModel = buildJavascriptLpModel({
      allVariableIds: testAllVarIds,
      objectiveCostVector: objectiveBuild?.objective_cost_vector || {},
      variableBoundsMap: { ...testBoundsMap, ...(testDeviationBuild.variable_bounds_map || {}) },
      basisConstraint,
      solverReadyConstraints: testDeviationBuild.solver_rows || []
    });

    const solve = await solveWithJavascriptLp(testModel);
    const lpInfeasible = solve?.result?.feasible === false || solve?.result?.result === 'Infeasible';
    if (!solve?.ok || lpInfeasible) continue;

    const testObjectiveRaw = toNumber(solve?.result?.result, null);
    if (!isFiniteNumber(testObjectiveRaw)) continue;

    const basis = toNumber(context.formula_basis, 100);
    const testObjectivePerUnit = round4(testObjectiveRaw / (basis > 0 ? basis : 100));

    if (!isFiniteNumber(baseObjectivePerTon)) continue;

    // ΔObjective scaled to $/tonne or $/short ton (base is still per kg/lb)
    const deltaPerTon = perFeedUnitToPerTon(testObjectivePerUnit - baseObjectivePerTon, context.weight_unit);

    // Savings = cost reduction (negative delta = cheaper after relaxation)
    const savingsPerTon = round4(-deltaPerTon); // positive = saves money
    const savingsPerUnit = round4(savingsPerTon / PERTURBATION_PCT); // per 1% change

    // Direction: 'up' = more of this ingredient is cheaper, 'down' = less would be cheaper
    const direction = savingsPerTon > 0.001
      ? (isAtMax ? 'up' : 'down')    // relaxing max → use more; relaxing min → use less
      : savingsPerTon < -0.001
      ? (isAtMax ? 'down' : 'up')
      : 'none';

    if (direction === 'none') continue; // no meaningful shadow price

    const ingMeta = (ingredientsEnabled || []).find(i => i.id === ingId);

    results.push({
      id: ingId,
      display_name: ingMeta?.display_name || ingId,
      binding_side: isAtMax ? 'max' : 'min',
      shadow_price_direction: direction,
      shadow_price_per_unit: Math.abs(savingsPerUnit),
      shadow_price_unit: isAtMax ? 'per 1% increase in Max' : 'per 1% decrease in Min',
      estimated_savings_per_ton: Math.abs(savingsPerTon)
    });
  }

  return results;
}

/** LP cost after /basis is $/kg or $/lb of feed. Nutritionist shadows are per tonne / short ton. */
function shadowTonMultiplier(weightUnit) {
  const u = String(weightUnit || "kg").toLowerCase();
  return (u === "lb" || u === "lbs" || u === "pound" || u === "pounds") ? 2000 : 1000;
}

function perFeedUnitToPerTon(value, weightUnit) {
  const n = toNumber(value, null);
  if (!isFiniteNumber(n)) return null;
  return round4(n * shadowTonMultiplier(weightUnit));
}

function calculateIngredientCostPerTonFromLpResult({
  lpRawResult,
  ingredientVariableIds,
  objectiveCostVector,
  formulaBasis
}) {
  const raw = lpRawResult || {};
  const basis = toNumber(formulaBasis, 100);
  const safeBasis = basis > 0 ? basis : 100;

  let total = 0;

  for (const id of ingredientVariableIds || []) {
    const value = toNumber(raw[id], 0);
    const unitCost = toNumber(objectiveCostVector?.[id], 0);
    if (!isFiniteNumber(value) || !isFiniteNumber(unitCost)) continue;
    total += value * unitCost;
  }

  return total / safeBasis;
}
router.post("/v1/optimize", async (req, res) => {
  try {
    const startedAt = Date.now();
    const body = req.body || {};
    const errors = [];

    // true_ratio_constraints: [{key, source, factor, op, required}]
    // Equation output is fixed (source STD × factor). OPTZ of Lys/CP must not rewrite the floor.
    const trueRatioConstraints = Array.isArray(body.true_ratio_constraints)
      ? body.true_ratio_constraints.filter(
          r => r && typeof r.key === 'string' && typeof r.source === 'string' && isFiniteNumber(Number(r.factor))
        ).map(r => ({
          key: r.key,
          source: r.source,
          factor: Number(r.factor),
          op: r.op || '≥',
          label: r.label || r.key,
          required: isFiniteNumber(Number(r.required)) ? Number(r.required) : null,
          source_value: isFiniteNumber(Number(r.source_value)) ? Number(r.source_value) : null,
          penalty: isFiniteNumber(Number(r.penalty)) ? Number(r.penalty) : null
        }))
      : [];

    const context = {
      locale: body.locale || "US",
      species: body.species || null,
      type: body.type || null,
      production: body.production || null,
      breed: body.breed || null,
      phase: body.phase || null,
      region: body.region || "us",
      version: body.version || "v1",
      objective: body.objective || "least_cost",
      gain_data: (body.gain_data && typeof body.gain_data === "object") ? {
        fcr: toNumber(body.gain_data.fcr, null),
        daily_gain: toNumber(body.gain_data.daily_gain, null),
        product_price: toNumber(body.gain_data.product_price, null),
        daily_feed_intake: toNumber(body.gain_data.daily_feed_intake, null),
        milk_yield: toNumber(body.gain_data.milk_yield, null),
      } : null,
      formula_basis: toNumber(body.formula_basis, 100),
      weight_unit: String(body.weight_unit || body.batch_unit || "kg").toLowerCase(),
      cp_apply_mode: body.cp_apply_mode || "RECOMPUTE_SID_FROM_TOTAL",
      penalties: {
  nutrient_low: toNumber(body?.penalties?.nutrient_low, 20000),
  nutrient_high: toNumber(body?.penalties?.nutrient_high, 20000),
  nutrient_target: toNumber(body?.penalties?.nutrient_target, 2000),
  movement: toNumber(
    body?.penalties?.movement,
    body.optimization_mode === 'reformulation' ? 5 : 0
  )
}
    };

    if (!Array.isArray(body.ingredient_pool) || body.ingredient_pool.length === 0) {
      errors.push("ingredient_pool is required and must be a non-empty array");
    }

    if (!Array.isArray(body.nutrient_constraints) || body.nutrient_constraints.length === 0) {
      errors.push("nutrient_constraints is required and must be a non-empty array");
    }

    const normalizedIngredients = Array.isArray(body.ingredient_pool)
      ? body.ingredient_pool.map(validateIngredient)
      : [];

    const normalizedConstraints = Array.isArray(body.nutrient_constraints)
      ? body.nutrient_constraints.map(validateConstraint)
      : [];

    for (const item of normalizedIngredients) {
      errors.push(...item.errors);
    }
    for (const item of normalizedConstraints) {
      errors.push(...item.errors);
    }

    const ingredientsAll = normalizedIngredients.map(x => x.normalized);
    let ingredientsEnabled = ingredientsAll.filter(x => x.enabled);
    // Typed ingredient max from the client is already on ing.max.
    // Mill-practice inclusion (oil, corn, crystals, …) is Issues-only.
    const constraintsAll = normalizedConstraints.map(x => x.normalized);
    for (const c of constraintsAll) {
      const k = String(c.key || "").toLowerCase();
      if (k === "sid_leu" || k === "total_leu") {
        c.min = null;
      }
    }
    // Ideal protein: SID floors already set amino quality. A hard CP min
    // (e.g. grower 25%+) forces gluten/SBM and blocks corn. Keep CP only if
    // the nutritionist typed Min/Max on that row.
    const hasSidFloor = constraintsAll.some((c) => {
      const k = String(c.key || "").toLowerCase();
      return k.startsWith("sid_") && isFiniteNumber(c.min);
    });
    if (hasSidFloor) {
      for (const c of constraintsAll) {
        const k = String(c.key || "").toLowerCase();
        if (k !== "cp" && k !== "cp_pct" && k !== "crude_protein") continue;
        if (String(c.spec_class || "").toLowerCase() === "minmax") continue;
        if (normalizeKey(c.hardness || "hard") === "soft") continue;
        c.min = null;
      }
    }
    // Corn/SBM already overshoots SID floors. Auto-derived Max=Min on SID AAs makes the LP infeasible.
    // But if the nutritionist explicitly typed a Max (spec_class='minmax'), honour it unconditionally.
    for (const c of constraintsAll) {
      const k = String(c.key || "").toLowerCase();
      if (!k.startsWith("sid_")) continue;
      if (!isFiniteNumber(c.max) || !isFiniteNumber(c.min)) continue;
      if (c.soft_max === true) continue;
      if (String(c.spec_class || "").toLowerCase() === "minmax") continue; // user explicitly typed this bound
      if (c.max <= c.min * 1.01) c.max = null;
    }
    applyNutrientBands(constraintsAll, context);

    if (ingredientsEnabled.length === 0) {
      errors.push("No enabled ingredients available for optimization");
    }

    if (!isFiniteNumber(context.formula_basis) || context.formula_basis <= 0) {
      errors.push("formula_basis must be a positive number");
    }

    const SUPPORTED_OBJECTIVES = ["least_cost", "cost_per_gain", "max_profit", "iofc"];
    if (!SUPPORTED_OBJECTIVES.includes(context.objective)) {
      errors.push(`Unsupported objective '${context.objective}'. Supported objectives: ${SUPPORTED_OBJECTIVES.join(", ")}`);
    }

    const gd = context.gain_data;
    const dairyIofc = context.objective === "iofc"
      && normalizeSpecies(context.species) === "dairy"
      && gd && isFiniteNumber(gd.milk_yield) && isFiniteNumber(gd.daily_feed_intake) && isFiniteNumber(gd.product_price);

    if ((context.objective === "cost_per_gain" || context.objective === "max_profit" || context.objective === "iofc") &&
        !dairyIofc &&
        !(gd && (isFiniteNumber(gd.fcr) || isFiniteNumber(gd.daily_gain)))) {
      errors.push(`objective '${context.objective}' requires farm FCR or daily gain (dairy IOFC may use milk yield + DMI + milk price instead).`);
    }

    if ((context.objective === "max_profit" || context.objective === "iofc") &&
        !(context.gain_data && isFiniteNumber(context.gain_data.product_price))) {
      errors.push(`objective '${context.objective}' requires gain_data.product_price.`);
    }

    if (errors.length > 0) {
      return res.status(400).json({
        status: "error",
        message: "Optimizer request validation failed",
        errors,
        meta: {
          engine: "AgroCore",
          module: "optimizer_v1",
          stage: "request_validation",
          timestamp_utc: new Date().toISOString()
        }
      });
    }

    const practicalControlResult = applyPracticalControlsToIngredients(ingredientsEnabled, body);
    // Pure LP (Bestmix/Brill philosophy): ingredient bounds and nutrient constraints are
    // used EXACTLY as the nutritionist specified. No hidden safety caps, no auto-inserted
    // nutrient bands. The LP itself decides inclusions based on cost × nutrient math alone.
    ingredientsEnabled = practicalControlResult.adjustedIngredients;
    const practicalControls = practicalControlResult.practicalControls;

    const totalMin = round4(sumBy(ingredientsEnabled, x => x.min));
    const totalMax = round4(sumBy(ingredientsEnabled, x => x.max));

    const basisFeasibilityNotes = [];
    if (totalMin > context.formula_basis) {
      basisFeasibilityNotes.push(
        `Sum of ingredient minimums (${totalMin}) exceeds formula basis (${context.formula_basis})`
      );
    }
    if (totalMax < context.formula_basis) {
      basisFeasibilityNotes.push(
        `Sum of ingredient maximums (${totalMax}) is below formula basis (${context.formula_basis})`
      );
    }

    const loaderResult = loadIngredientDbForContext(context);
    const ingredientDb = loaderResult.db || {};
    // Load user's FACT DB — primary nutrient source for custom ingredients.
    const userFactDb = loadUserFactDb(req.nutrixUser || '', body.active_db_id || null);
    const requestedNutrientKeys = constraintsAll.map(x => x.key);
    // Ensure source nutrients for ratio constraints are in the matrix even if not in breed std
    for (const rc of trueRatioConstraints) {
      if (!requestedNutrientKeys.includes(rc.source)) requestedNutrientKeys.push(rc.source);
      if (!requestedNutrientKeys.includes(rc.key)) requestedNutrientKeys.push(rc.key);
    }
    // Always include sid_lys when any SID amino acid is constrained — it is the reference AA.
    // The frontend sometimes omits sid_lys (e.g. when its breed-std target row has no value set),
    // but the LP must track it so stampCrystalPurity and the observation profile work correctly.
    const hasSidConstraint = requestedNutrientKeys.some(k => k.startsWith('sid_'));
    if (hasSidConstraint && !requestedNutrientKeys.includes('sid_lys')) {
      requestedNutrientKeys.push('sid_lys');
    }
    // Always track ee, linoleic, linolenic in the nutrient matrix so computeObservationProfile
    // can produce correct values.  These are observation-only (no LP constraint row is built
    // for them unless the frontend explicitly sent a min/max), but having them in the matrix
    // means calculateNutrientResultsFromFormula and the observation profile can use them.
    for (const obsKey of ['ee', 'linoleic', 'linolenic']) {
      if (!requestedNutrientKeys.includes(obsKey)) requestedNutrientKeys.push(obsKey);
    }

    // Auto-discover observation keys from FACT DB: any nutrient field that has a value in at
    // least one formula ingredient is added to the matrix so actuals are shown even without
    // a min/max constraint. This is safe — observation keys never generate LP constraint rows.
    if (Object.keys(userFactDb).length > 0) {
      const factObsSkip = new Set(['ingredient_id','ingredient_name','ingredient_code',
        'category','status','currency','price','price_basis','last_modified','modified_by',
        'lab_override_target','currency_mode','price_basis_mode','dm','moisture']);
      for (const ing of ingredientsEnabled) {
        const fr = userFactDb[normalizeKey(ing.display_name)] || userFactDb[normalizeKey(ing.id)];
        if (!fr) continue;
        for (const [fk, fv] of Object.entries(fr)) {
          if (factObsSkip.has(fk)) continue;
          if (fv == null || fv === '' || !Number.isFinite(Number(fv))) continue;
          const normFk = normalizeKey(fk);
          if (!requestedNutrientKeys.includes(normFk)) requestedNutrientKeys.push(normFk);
        }
      }
    }

    const ingredientResolutionItems = [];
    const nutrientCoefficientsUsed = [];
    const missingNutrientCoefficientItems = [];

    for (const ing of ingredientsEnabled) {
      // PRIORITY 1: User's FACT DB — look up by display_name then ingredient id.
      const factRow = userFactDb[normalizeKey(ing.display_name)] ||
                      userFactDb[normalizeKey(ing.id)] ||
                      null;

      // PRIORITY 2: Species reference DB — always resolve so we can fill any gap left by FACT DB.
      const resolvedRaw = resolveIngredientRecord(ingredientDb, ing.id, ing.display_name);
      const resolved = resolvedRaw
        ? { ...resolvedRaw, row: canonicalizeSyntheticAminoRow(resolvedRaw.row, millIngredientCode(ing), ing.display_name) }
        : null;

      const synIng = canonicalizeSyntheticAminoRow(ing, millIngredientCode(ing), ing.display_name);

      ingredientResolutionItems.push({
        requested_id: ing.id,
        requested_display_name: ing.display_name,
        resolved: !!(factRow || resolved),
        db_key: factRow ? ('factdb:' + (factRow.ingredient_id || factRow.ingredient_name)) : (resolved?.db_key || null),
        db_display_name: factRow?.ingredient_name || resolved?.row?.display_name || null,
        resolution_method: factRow ? 'factdb' : (resolved?.resolution_method || null)
      });

      const coeffs = {};
      for (const nutrientKey of requestedNutrientKeys) {
        const isDmMoist = nutrientKey === 'dm' || nutrientKey === 'moisture' || nutrientKey === 'dm_pct' || nutrientKey === 'moisture_pct';
        let value;
        if (isDmMoist) {
          const pair = resolveUserAsFedDmMoisture(ing);
          value = pair ? (nutrientKey === 'moisture' || nutrientKey === 'moisture_pct' ? pair.moisture : pair.dm) : null;
          if (!isFiniteNumber(value) && factRow) value = getNutrientValueForKey(factRow, nutrientKey);
          if (!isFiniteNumber(value) && resolved?.row) value = getNutrientValueForKey(resolved.row, nutrientKey);
        } else {
          // Per-nutrient merge: FACT DB first, species DB for any gap, payload as last resort
          if (factRow) value = getNutrientValueForKey(factRow, nutrientKey);
          if (!isFiniteNumber(value) && resolved?.row) value = getNutrientValueForKey(resolved.row, nutrientKey);
          if (!isFiniteNumber(value)) value = getNutrientValueForKey(synIng, nutrientKey);
        }
        if (isFiniteNumber(value)) {
          coeffs[nutrientKey] = value;
        } else {
          missingNutrientCoefficientItems.push({
            ingredient_id: ing.id,
            ingredient_name: ing.display_name,
            nutrient_key: nutrientKey,
            reason: 'nutrient_missing'
          });
        }
      }

      // sid_metcys = sid_met + sid_cys (derived)
      if (requestedNutrientKeys.includes('sid_metcys')) {
        const factSidMet = factRow ? getNutrientValueForKey(factRow, 'sid_met') : null;
        const dbSidMet   = resolved?.row ? getNutrientValueForKey(resolved.row, 'sid_met') : null;
        const bestSidMet = isFiniteNumber(factSidMet) ? factSidMet : (isFiniteNumber(dbSidMet) ? dbSidMet : getNutrientValueForKey(synIng, 'sid_met'));
        const factSidCys = factRow ? getNutrientValueForKey(factRow, 'sid_cys') : null;
        const dbSidCys   = resolved?.row ? getNutrientValueForKey(resolved.row, 'sid_cys') : null;
        const bestSidCys = isFiniteNumber(factSidCys) ? factSidCys : (isFiniteNumber(dbSidCys) ? dbSidCys : getNutrientValueForKey(synIng, 'sid_cys'));
        if (isFiniteNumber(bestSidMet)) {
          coeffs['sid_metcys'] = round4(bestSidMet + (isFiniteNumber(bestSidCys) ? bestSidCys : 0));
        }
      }

      nutrientCoefficientsUsed.push({
        requested_id: ing.id,
        requested_display_name: ing.display_name,
        resolved: !!(factRow || resolved),
        db_key: resolved?.db_key || null,
        coefficients: coeffs
      });
    }

    const matrixCellsExpected = ingredientsEnabled.length * requestedNutrientKeys.length;
    const matrixCellsWithValues = nutrientCoefficientsUsed.reduce(
      (s, row) => s + Object.keys(row.coefficients || {}).length,
      0
    );
   const matrixCellsMissing = Math.max(0, matrixCellsExpected - matrixCellsWithValues);

// =======================================
// Synthetic AA fallback: compute SID Arg
// Only for L-Arginine, and only if sid_arg is missing.
// Keep any nutritionist-entered sid_arg as-is.
// =======================================
ingredientsEnabled.forEach(ing => {
  const toNumSafe = (v) =>
    v == null || Number.isNaN(Number(v)) ? null : Number(v);

  const idNorm = String(ing.id || "").trim().toLowerCase();

  // We already have Evonik digestibility coefficients for other synthetic AAs.
  // This fallback is only for L-Arginine because sid_arg is currently missing.
  if (idNorm === "l_arg") {
    const totalArg = toNumSafe(ing.total_arg);
    const sidArg = toNumSafe(ing.sid_arg);

    if (sidArg == null && totalArg != null) {
      const digestibility = 0.93; // safe default within 90�95%
      ing.sid_arg = round4(totalArg * digestibility);
    }
  }
});

    // Remove frontend auto-added "helper" ingredients before building the LP.
    // The frontend appends extra phosphate/oil/AA rows (marked _autoadded=true) to widen
    // the LP search space, but these rows are NOT in the user's formula display. If the LP
    // assigns them any inclusion the displayed total falls below 100%.
    // We keep every ingredient the user explicitly placed in their formula (even if its ID
    // happens to be all-lowercase, e.g. "mcp" from a system catalog pick).
    const _beforeAutoFilter = ingredientsEnabled.length;
    ingredientsEnabled = ingredientsEnabled.filter(ing => !ing._autoadded);
    if (ingredientsEnabled.length < _beforeAutoFilter) {
      console.log(`[optimize] auto-inject filter: removed ${_beforeAutoFilter - ingredientsEnabled.length} auto-added helper ingredients, ${ingredientsEnabled.length} remain`);
    }

const ingredientVariableIds = ingredientsEnabled.map(x => x.id);

    // ── Enzyme dose-response: iterative convergence engine ───────────────────
    // Loads response curves for all enzyme/additive ingredients in the pool,
    // then solves LP iteratively until actual doses match estimated doses (or max 5 iters).
    // After convergence: applies substrate-level adjustment (xylanase/NSPase) and
    // multi-enzyme synergy corrections.
    let enzymeResponseMeta = {};
    // We need to save a deep-clone of nutrientCoefficientsUsed before enzyme injection
    // so each iteration starts from clean base values (no stacking of enzyme releases).
    const _enzymeCoeffsBase = JSON.parse(JSON.stringify(nutrientCoefficientsUsed));
    let _enzymeConvIter = 0;
    let _enzymeCurveMap = {};
    let _hasEnzymes = false;

    try {
      const _username = req.nutrixUser || 'default';
      const _edb = getNutrixDb(_username);
      const _placeholders = ingredientVariableIds.map(() => '?').join(',');
      const _curveRows = ingredientVariableIds.length
        ? _edb.prepare(
            `SELECT ingredient_id, nutrient_key, curve_name, breakpoints, unit, model_type, model_params
             FROM ingredient_response_curves
             WHERE ingredient_id IN (${_placeholders})`
          ).all(...ingredientVariableIds)
        : [];

      if (_curveRows.length > 0) {
        _hasEnzymes = true;
        for (const row of _curveRows) {
          (_enzymeCurveMap[row.ingredient_id] = _enzymeCurveMap[row.ingredient_id] || []).push({
            nutrient_key: row.nutrient_key,
            curve_name: row.curve_name || null,
            breakpoints: JSON.parse(row.breakpoints || '[]'),
            unit: row.unit || 'inclusion_pct',
            model_type: row.model_type || 'breakpoints',
            model_params: JSON.parse(row.model_params || '{}'),
          });
        }
      }
    } catch (_enzymeErr) {
      console.warn('[optimize] Enzyme curve load failed:', _enzymeErr?.message);
    }

    const _matrixBasisParsed = parseMatrixNutrientBasis(body.matrix_nutrient_basis);
    const _enzymeCreditSource = parseEnzymeCreditSource(body.enzyme_credit_source);
    const _enzymeClassified = {};
    for (const [ingId, curves] of Object.entries(_enzymeCurveMap)) {
      _enzymeClassified[ingId] = classifyEnzymeProduct(ingId, curves);
    }
    let _enzymeSuppressed = computeBlendSuppression(_enzymeClassified);
    _enzymeSuppressed = suppressCurvesWhenFamilyBookCredited(_enzymeClassified, _enzymeSuppressed, _enzymeCreditSource);

    // Helper: inject enzyme effective nutrients into a fresh copy of the base coefficients
    function _applyEnzymeDosesToCoeffs(doseEstimates) {
      const coeffs = JSON.parse(JSON.stringify(_enzymeCoeffsBase));
      const appliedMeta = {};
      const _basis = context.formula_basis || 100;

      for (const [ingId, curves] of Object.entries(_enzymeCurveMap)) {
        const ing = ingredientsEnabled.find(x => x.id === ingId);
        if (!ing) continue;
        const dosePct = doseEstimates[ingId] ?? ((() => {
          const mn = ((ing.min ?? 0) / _basis) * 100;
          const mx = ((ing.max ?? 0) / _basis) * 100;
          return mn === mx ? mn : (mn + mx) / 2 || mx * 0.5 || 0.005;
        })());

        const suppressed = _enzymeSuppressed[ingId];
        const creditSrc = creditSourceFor(ingId, _enzymeCreditSource);
        const skipBySource = creditSrc === 'book' || creditSrc === 'none';
        const skippedHere = [];
        const effectiveNutrients = {};

        if (!suppressed && !skipBySource) {
          for (const curve of curves) {
            const nk = normalizeKey(curve.nutrient_key);
            if (_matrixBasisParsed.withEnzyme.has(nk)) {
              skippedHere.push(nk);
              continue;
            }
            const val = evaluateEnzymeCurve(curve.model_type, curve.breakpoints, curve.model_params, dosePct);
            if (val !== null && Number.isFinite(val)) {
              effectiveNutrients[nk] = val;
            }
          }
        }

        const entry = coeffs.find(e => e.requested_id === ingId);
        if (entry && Object.keys(effectiveNutrients).length) {
          // Curve value nv is a diet-level release at dosePct (e.g. 0.165% avP at 1% phytase).
          // LP coefficient = nv × (basis / dosePct) so that:
          //   result% = inclusion% × coeff / basis  →  1% × 16.5 / 100 = 0.165% ✓
          const _lpScale = dosePct > 0 ? (_basis / dosePct) : 1;
          for (const [nk, nv] of Object.entries(effectiveNutrients)) {
            entry.coefficients[nk] = round4((entry.coefficients[nk] ?? 0) + nv * _lpScale);
          }
        }
        appliedMeta[ingId] = {
          dosePct,
          effectiveNutrients,
          curves,
          credit_source: creditSrc,
          skipped: !!(suppressed || skipBySource),
          skip_reason: suppressed?.reason
            || (skipBySource ? `credit_source_${creditSrc}` : null)
            || (skippedHere.length ? 'matrix_with_enzyme' : null),
          covering_blend: suppressed?.covering_blend || null,
          skipped_nutrients: skippedHere
        };
      }
      return { coeffs, appliedMeta };
    }

    // Initialise dose estimates from bounds midpoint
    const _basis = context.formula_basis || 100;
    let _doseEstimates = {};
    for (const [ingId] of Object.entries(_enzymeCurveMap)) {
      const ing = ingredientsEnabled.find(x => x.id === ingId);
      if (!ing) continue;
      const mn = ((ing.min ?? 0) / _basis) * 100;
      const mx = ((ing.max ?? 0) / _basis) * 100;
      _doseEstimates[ingId] = mn === mx ? mn : (mn + mx) / 2 || mx * 0.5 || 0.005;
    }

    // If no enzymes, just use existing nutrientCoefficientsUsed as-is (no-op)
    if (_hasEnzymes) {
      const { coeffs } = _applyEnzymeDosesToCoeffs(_doseEstimates);
      for (let i = 0; i < coeffs.length; i++) {
        nutrientCoefficientsUsed[i].coefficients = coeffs[i].coefficients;
      }
    }
    // ── End initial enzyme injection (iterative solve loop runs after LP) ─────

    const ingredientCostVector = {};
    ingredientsEnabled.forEach(ing => {
      ingredientCostVector[ing.id] = toNumber(ing.cost, 0);
    });

    const nutrientMatrix = {};
    for (const nutrientKey of requestedNutrientKeys) {
      nutrientMatrix[nutrientKey] = {};
      nutrientCoefficientsUsed.forEach(row => {
        const ingId = row.requested_id;
        const coeff = row.coefficients?.[nutrientKey];
        nutrientMatrix[nutrientKey][ingId] = isFiniteNumber(coeff) ? coeff : 0;
      });
    }
    // DEBUG: log sid_leu coefficients per ingredient
    if (nutrientMatrix.sid_leu) {
      const leuCoeffs = Object.entries(nutrientMatrix.sid_leu)
        .filter(([,v]) => v > 0)
        .map(([id, v]) => `${id}=${v}`)
        .join(' | ');
      console.log('[sid_leu_matrix] coefficients:', leuCoeffs || 'ALL ZERO');
    }

    // Apply user-supplied nutrient overrides (from matrix editor)
    const nutrientOverrides = body.nutrient_overrides || {};
    for (const [nutKey, ingMap] of Object.entries(nutrientOverrides)) {
      if (!nutrientMatrix[nutKey]) nutrientMatrix[nutKey] = {};
      for (const [ingId, val] of Object.entries(ingMap)) {
        if (typeof val === 'number' && isFiniteNumber(val)) {
          nutrientMatrix[nutKey][ingId] = val;
        }
      }
    }
    // ── Canonical coefficient auto-fill ──────────────────────────────────────
    // If an ingredient has 0 / missing values in the DB, fill from the standard
    // reference library (Rostagno 2017 / NRC 2012) by matching ingredient name.
    // This prevents the LP from treating e.g. corn as CP-free or SBM as
    // SID-Arg-free simply because the user's data file was incomplete.
    // Rule: only fills nutrient×ingredient cells that are genuinely 0 or absent;
    //       never overwrites values the user explicitly supplied.
    {
      const ingById = Object.fromEntries(ingredientsEnabled.map(x => [x.id, x]));
      const canonicalFillLog = [];
      for (const row of nutrientCoefficientsUsed) {
        const ingId = row.requested_id;
        const ing = ingById[ingId];
        if (!ing) continue;
        // Skip synthetic AAs — their coefficients are managed by stampCrystalPurity.
        if (syntheticKeysForIngredient(ing).length > 0) continue;
        const ingName = ing.display_name || ing.name || row.ingredient_name || '';
        const canonical = matchIngredientToCanonical(ingName, ingId);
        if (!canonical) continue;
        const filled = [];
        for (const [nutKey, canonicalVal] of Object.entries(canonical)) {
          const matrixRow = nutrientMatrix[nutKey];
          if (!matrixRow) continue; // nutrient not in this formula's constraint set
          const existing = matrixRow[ingId];
          if (typeof existing === 'number' && Number.isFinite(existing) && existing > 0) continue;
          if (!Number.isFinite(canonicalVal)) continue;
          matrixRow[ingId] = canonicalVal;
          filled.push(nutKey);
        }
        if (filled.length > 0) {
          canonicalFillLog.push({ id: ingId, name: ingName, filled });
        }
      }
      if (canonicalFillLog.length > 0) {
        console.log(`[optimize] canonical-fill applied to ${canonicalFillLog.length} ingredient(s):`);
        canonicalFillLog.forEach(e => console.log(`  ${e.name} (${e.id}): ${e.filled.join(', ')}`));
        context._canonical_fill_log = canonicalFillLog;
      }
    }
    // ── End canonical auto-fill ───────────────────────────────────────────────

    applySyntheticPurityToMatrix(nutrientMatrix, ingredientsEnabled);
    applyOilFattyAcidsToMatrix(nutrientMatrix, ingredientsEnabled);
    const millSynth = (ingredientsEnabled || []).map((ing) => ({
      id: ing.id,
      mill: millIngredientCode(ing),
      name: ing.display_name,
      keys: syntheticKeysForIngredient(ing),
      sid_trp: nutrientMatrix.sid_trp ? nutrientMatrix.sid_trp[ing.id] : null
    })).filter((x) => x.keys.length || (Number(x.sid_trp) > 1));
    console.log("[optimize] mill_synth", JSON.stringify(millSynth));
    console.log("[optimize] sid_trp coeffs", JSON.stringify(nutrientMatrix.sid_trp || {}));

    const ingredientBoundsMap = {};
    ingredientsEnabled.forEach(ing => {
      ingredientBoundsMap[ing.id] = {
        min: ing.min,
        max: ing.max
      };
    });

    // ── Automatic mineral floor injection ────────────────────────────────────
    // When hard Ca/AvP/Na constraints are set, force-floor the relevant mineral
    // ingredients so the LP cannot drop them to zero while paying penalty costs.
    // This implements the "ingredient group constraints" concept: each nutrient
    // maps to a group of carrier ingredients; when the nutrient has a hard min
    // those carriers MUST contribute.
    {
      const getNutMin = (key) => {
        const c = constraintsAll.find(x => String(x.key || '').toLowerCase() === key);
        return (c && isFiniteNumber(c.min)) ? c.min : null;
      };
      const getNutMatrix = (key) => nutrientMatrix[key] || {};

      // Lower-bound natural contribution: only count ingredients with explicit user-set
      // minimums (guaranteed in formula). Underestimates natural supply → gives a
      // higher mineral requirement estimate → safer mineral floors.
      const naturalContrib = (nutKey, mineralsSet) => {
        const mat = getNutMatrix(nutKey);
        let total = 0;
        for (const ing of ingredientsEnabled) {
          const role = ingredientRole(ing);
          if (mineralsSet.has(ing.id) || role === 'crystal') continue;
          const coeff = mat[ing.id] || 0;
          // Only use explicit user-set minimums as guaranteed inclusion
          const explicitMin = (isFiniteNumber(ing.min) && ing.min > 0) ? ing.min : 0;
          total += (explicitMin / 100) * coeff;
        }
        return total;
      };

      // Ca: limestone and DCP both supply Ca
      const caMin = getNutMin('ca');
      if (isFiniteNumber(caMin) && caMin > 0) {
        const caMat = getNutMatrix('ca');
        // Limestone = primary Ca source
        const limeIngs = ingredientsEnabled.filter(x => {
          const n = `${x.display_name || ''} ${x.id || ''}`.toLowerCase();
          return ingredientRole(x) === 'mineral' && /limestone|calcium carbonate|caco3/.test(n);
        });
        // DCP/MCP = secondary Ca source (also supply AvP so capped to AvP needs)
        const dcpIngs = ingredientsEnabled.filter(x => {
          const n = `${x.display_name || ''} ${x.id || ''}`.toLowerCase();
          return ingredientRole(x) === 'mineral' && /dicalcium|monocalcium|\bdcp\b|\bmcp\b/.test(n);
        });
        const limeSet = new Set([...limeIngs, ...dcpIngs].map(x => x.id));

        if (limeIngs.length > 0 || dcpIngs.length > 0) {
          // Estimate natural Ca from non-mineral ingredients
          const naturalCa = naturalContrib('ca', limeSet);
          const caDeficit = Math.max(0, caMin - naturalCa);

          if (caDeficit > 0) {
            // Distribute: let DCP provide up to its AvP-needed share, Limestone covers the rest
            const avpMin = getNutMin('avp') || 0;
            const avpMat = getNutMatrix('avp');
            const naturalAvp = naturalContrib('avp', limeSet);
            const avpDeficit = Math.max(0, avpMin - naturalAvp);

            let caFromDcp = 0;
            for (const dcp of dcpIngs) {
              const avpCoeff = avpMat[dcp.id] || 0;
              const caCoeff = caMat[dcp.id] || 0;
              if (avpCoeff > 0) {
                const dcpForAvp = (avpDeficit / avpCoeff) * 100;
                const curMax = ingredientBoundsMap[dcp.id]?.max ?? toNumber(dcp.max, 2.5);
                const dcpFloor = Math.min(dcpForAvp * 0.10, curMax * 0.5);
                const existingMin = ingredientBoundsMap[dcp.id]?.min ?? toNumber(dcp.min, 0);
                ingredientBoundsMap[dcp.id].min = round4(Math.max(existingMin, dcpFloor));
                caFromDcp += (dcpFloor / 100) * caCoeff;
              }
            }

            const caStillNeeded = Math.max(0, caDeficit - caFromDcp);
            for (const lime of limeIngs) {
              const caCoeff = caMat[lime.id] || 0;
              if (caCoeff > 0 && caStillNeeded > 0) {
                const limeFloor = (caStillNeeded / caCoeff) * 100 * 0.10;
                const curMax = ingredientBoundsMap[lime.id]?.max ?? toNumber(lime.max, 2.5);
                const clampedFloor = Math.min(limeFloor, curMax * 0.5);
                const existingMin = ingredientBoundsMap[lime.id]?.min ?? toNumber(lime.min, 0);
                ingredientBoundsMap[lime.id].min = round4(Math.max(existingMin, clampedFloor));
              }
            }
          }
        }
      }

      // Na: salt/NaHCO3 supply Na
      const naMin = getNutMin('na');
      if (isFiniteNumber(naMin) && naMin > 0) {
        const naMat = getNutMatrix('na');
        const saltIngs = ingredientsEnabled.filter(x => {
          const n = `${x.display_name || ''} ${x.id || ''}`.toLowerCase();
          return (ingredientRole(x) === 'micro' || ingredientRole(x) === 'mineral') &&
            (/\bsalt\b|nacl|sodium_chloride/.test(n) || /sodium.*bicarb|bicarb.*sodium/.test(n));
        });
        if (saltIngs.length > 0) {
          const saltSet = new Set(saltIngs.map(x => x.id));
          const naturalNa = naturalContrib('na', saltSet);
          const naDeficit = Math.max(0, naMin - naturalNa);
          if (naDeficit > 0) {
            const primary = saltIngs[0];
            const naCoeff = naMat[primary.id] || 0;
            if (naCoeff > 0) {
              const saltFloor = (naDeficit / naCoeff) * 100 * 0.10;
              const curMax = ingredientBoundsMap[primary.id]?.max ?? toNumber(primary.max, 0.45);
              const clampedFloor = Math.min(saltFloor, curMax * 0.9);
              const existingMin = ingredientBoundsMap[primary.id]?.min ?? toNumber(primary.min, 0);
              ingredientBoundsMap[primary.id].min = round4(Math.max(existingMin, clampedFloor));
            }
          }
        }
      }
    }
    // ── End mineral floor injection ───────────────────────────────────────────

    const basisConstraint = {
      type: "equality",
      coefficients: ingredientVariableIds.reduce((acc, id) => {
        acc[id] = 1;
        return acc;
      }, {}),
      rhs: context.formula_basis
    };

    const nutrientConstraintRows = constraintsAll.map(c => ({
      nutrient: c.key,
      coefficients: nutrientMatrix[c.key] || {},
      min: c.min ?? null,
      max: c.max ?? null,
      target: c.target ?? null,
      hardness: c.hardness,
      penalty_low: c.penalty_low ?? null,
      penalty_high: c.penalty_high ?? null,
      penalty_target: c.penalty_target ?? null
    }));

    const deviationBuild = buildDeviationVariables({
      constraintsAll,
      nutrientMatrix,
      formulaBasis: context.formula_basis,
      penalties: context.penalties
    });

    const movementBuild = buildMovementVariables({
      ingredientsEnabled,
      startingFormula: body.starting_formula,
      penalties: context.penalties
    });

    let effectiveIngredientCostVector = ingredientCostVector;
    let profitLpMeta = {
      true_lp_objective: false,
      note: "Least-cost feed. IOFC/cost-gain reported from farm inputs after the solve.",
    };
    if (context.objective === "max_profit" || context.objective === "iofc") {
      const profitBuild = buildProfitAdjustedCostVector({
        objective: context.objective,
        gainData: context.gain_data,
        species: context.species,
        ingredientIds: ingredientVariableIds,
        ingredientCostVector,
        nutrientMatrix
      });
      effectiveIngredientCostVector = profitBuild.adjustedCostVector;
      profitLpMeta = {
        true_lp_objective: true,
        species_model: normalizeSpecies(context.species),
        nutrient_economic_values: profitBuild.nutrientEconomicValues,
        note: "Ingredient costs have been adjusted by species-specific nutrient revenue contributions. The LP truly optimizes for profit, not just feed cost."
      };
    }

const objectiveBuild = buildObjectiveFunction({
  ingredientIds: ingredientVariableIds,
  ingredientCostVector: effectiveIngredientCostVector,
  deviationBuild,
  movementBuild
});

    const variableBoundsMap = {
      ...ingredientBoundsMap,
      ...objectiveBuild.extra_variable_bounds_map
    };

    // True cross-nutrient ratio LP constraints.
    // Instead of converting "ME ≥ CP × 159.82" to a fixed ME floor (ME ≥ STD_CP × 159.82),
    // we build a proper cross-nutrient row: Σ((ME_i - 159.82 × CP_i) × x_i) ≥ 0.
    // This enforces the ratio regardless of what the optimizer chooses for CP.
    const ratioLpRows = [];
    const ratioBoundsMap = {};
    const ratioObjectiveMap = {};
    for (const rc of trueRatioConstraints) {
      const keyCoeffs = nutrientMatrix[rc.key] || {};
      const srcCoeffs = nutrientMatrix[rc.source] || {};
      const hasSrcMatrix = Object.keys(srcCoeffs).length > 0;

      let coeffs = {};
      let rhs = 0;

      if (hasSrcMatrix) {
        // Build true cross-nutrient constraint: key - factor × source ≥ 0
        // This enforces the ratio at whatever level the optimizer picks for both nutrients.
        for (const ingId of ingredientVariableIds) {
          const k = isFiniteNumber(keyCoeffs[ingId]) ? keyCoeffs[ingId] : 0;
          const s = isFiniteNumber(srcCoeffs[ingId]) ? srcCoeffs[ingId] : 0;
          const net = k - Number(rc.factor) * s;
          if (Math.abs(net) > 1e-9) coeffs[ingId] = round4(net);
        }
        rhs = 0;
      } else {
        // Fallback: source not in matrix — use fixed floor from STD value
        if (!isFiniteNumber(rc.required)) continue;
        const boundRow = constraintsAll.find(
          c => String(c.key || '').toLowerCase() === String(rc.key || '').toLowerCase()
        );
        if (boundRow) {
          if (isFiniteNumber(boundRow.max)) rc.required = Math.min(rc.required, boundRow.max);
          if (isFiniteNumber(boundRow.min)) rc.required = Math.max(rc.required, boundRow.min);
        }
        for (const ingId of ingredientVariableIds) {
          const k = isFiniteNumber(keyCoeffs[ingId]) ? keyCoeffs[ingId] : 0;
          if (k !== 0) coeffs[ingId] = k;
        }
        rhs = round4(rc.required * context.formula_basis);
      }

      const normKey = normalizeKey(`ratio__${rc.key}__${rc.source}`);
      const op = (rc.op || '≥').trim();
      const isGte = op === '≥' || op === '>=' || op === '>';
      const isLte = op === '≤' || op === '<=' || op === '<';
      const isEq  = !isGte && !isLte;

      if (isGte || isEq) {
        ratioLpRows.push({
          nutrient: `${normKey}_min`,
          sense: '>=',
          rhs,
          coefficients: { ...coeffs },
          hardness: 'hard',
          source: 'ratio'
        });
      }
      if (isLte || isEq) {
        ratioLpRows.push({
          nutrient: `${normKey}_max`,
          sense: '<=',
          rhs,
          coefficients: { ...coeffs },
          hardness: 'hard',
          source: 'ratio'
        });
      }
    }

    const solverReadyConstraints = [
      ...deviationBuild.solver_rows,
      ...movementBuild.solver_rows,
      ...ratioLpRows
    ];

    // ── Category group constraints (FeedForté parity) ────────────────────────
    // Build category → member ID map from the ingredient pool's category field.
    // The frontend sends `category` on each ingredient in the pool.
    const _catMemberMap = {};
    for (const ing of ingredientsEnabled) {
      const cat = String(ing.category || '').trim();
      if (!cat) continue;
      if (!_catMemberMap[cat]) _catMemberMap[cat] = [];
      _catMemberMap[cat].push(ing.id);
    }
    const catConstraintsInput = Array.isArray(body.category_constraints) ? body.category_constraints : [];
    for (const catC of catConstraintsInput) {
      const catName = String(catC.name || '').trim();
      if (!catName) continue;
      const members = (_catMemberMap[catName] && _catMemberMap[catName].length)
        ? _catMemberMap[catName]
        : (catC.member_ids || []).filter(id => ingredientVariableIds.includes(id));
      if (!members.length) {
        console.warn(`[optimize] category-group "${catName}": no matching ingredients in pool — skipped`);
        continue;
      }
      const coeffs = Object.fromEntries(members.map(id => [id, 1]));
      const catKey = `cat__${catName.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
      if (isFiniteNumber(catC.min) && catC.min >= 0) {
        solverReadyConstraints.push({
          nutrient: `${catKey}__min`,
          sense: '>=',
          rhs: round4(catC.min / 100 * context.formula_basis),
          coefficients: coeffs,
          hardness: 'hard',
          source: 'category_group'
        });
      }
      if (isFiniteNumber(catC.max) && catC.max >= 0) {
        solverReadyConstraints.push({
          nutrient: `${catKey}__max`,
          sense: '<=',
          rhs: round4(catC.max / 100 * context.formula_basis),
          coefficients: coeffs,
          hardness: 'hard',
          source: 'category_group'
        });
      }
    }
    if (catConstraintsInput.length) {
      const catRows = solverReadyConstraints.filter(r => r.source === 'category_group');
      console.log(`[optimize] category-group constraints: ${catConstraintsInput.length} group(s), ${catRows.length} LP row(s) added`);
    }
    // ── End category group constraints ───────────────────────────────────────

    // Merge ratio deviation variable bounds and objective costs into the main maps
    Object.assign(variableBoundsMap, ratioBoundsMap);
    const ratioDevIds = Object.keys(ratioObjectiveMap);
    for (const id of ratioDevIds) {
      objectiveBuild.all_variable_ids.push(id);
      objectiveBuild.objective_cost_vector[id] = ratioObjectiveMap[id];
    }

    const optimizerLpModel = {
      variables: objectiveBuild.all_variable_ids,
      objective: {
        type: "minimize_cost_plus_penalties",
        cost_vector: objectiveBuild.objective_cost_vector
      },
      ingredient_bounds: ingredientBoundsMap,
      extra_variable_bounds: objectiveBuild.extra_variable_bounds_map,
      basis_constraint: basisConstraint,
      nutrient_constraints: nutrientConstraintRows,
      deviation_variables: deviationBuild.diagnostics,
      movement_variables: movementBuild.diagnostics,
      objective_breakdown: objectiveBuild.objective_breakdown
    };

    const javascriptLpModel = buildJavascriptLpModel({
      allVariableIds: objectiveBuild.all_variable_ids,
      objectiveCostVector: objectiveBuild.objective_cost_vector,
      variableBoundsMap,
      basisConstraint,
      solverReadyConstraints
    });

    const lpSolveAttempt =
      basisFeasibilityNotes.length === 0
        ? await solveWithJavascriptLp(javascriptLpModel)
        : {
            ok: false,
            status: "precheck_failed",
            message: "Basis feasibility precheck failed before LP solve.",
            result: null
          };

    let optimizedFormula = [];
    let totalInclusion = 0;
    let totalCostPerTon = 0;
    let solveDiagnostics = {
      at_min: [],
      at_max: [],
      excluded: [],
      remaining_gap: 0
    };

    let nutrientResults = {};
    let constraintSatisfaction = [];
    let finalSolveMode = "basis_only_fallback";
    let lpObjectiveValue = null;
    let lpRawResult = lpSolveAttempt.result || null;

    const lpHasNumericObjective =
      isFiniteNumber(toNumber(lpSolveAttempt?.result?.result, null));

    const lpExplicitlyInfeasible =
      lpSolveAttempt?.result?.feasible === false ||
      lpSolveAttempt?.result?.result === "Infeasible";

    const lpHasDecisionValues =
      !!lpSolveAttempt?.result &&
      ingredientVariableIds.some(id =>
        isFiniteNumber(toNumber(lpSolveAttempt.result[id], null))
      );

    const lpFeasible =
      !!lpSolveAttempt.ok &&
      !!lpSolveAttempt.result &&
      !lpExplicitlyInfeasible &&
      (lpHasNumericObjective || lpHasDecisionValues);

    // LP diagnostic: log key solve facts so server logs reveal whether LP ran,
    // which path was taken, and which nutrients ended up violated post-solve.
    console.log(`[optimize] LP feasible=${lpFeasible} ok=${lpSolveAttempt.ok} explicit_infeasible=${lpExplicitlyInfeasible} obj=${toNumber(lpSolveAttempt?.result?.result, null)?.toFixed(2) ?? 'n/a'} ingredients=${ingredientVariableIds.length} constraints=${solverReadyConstraints.length} basis=${context.formula_basis}`);
    if (lpSolveAttempt.result) {
      const lpRawSum = round4(ingredientVariableIds.reduce((s, id) => s + toNumber(lpSolveAttempt.result[id], 0), 0));
      console.log(`[optimize] LP raw sum of ingredient vars=${lpRawSum} (should equal basis=${context.formula_basis})`);
    }
    if (!lpFeasible) {
      console.log("[optimize] hard bounds", JSON.stringify(
        (constraintsAll || []).map((c) => ({ k: c.key, min: c.min, max: c.max })).filter((c) => c.min != null || c.max != null)
      ));
    }
    // Log any violated hard constraints (non-zero dev_hard_* variables) so server logs
    // show exactly which constraints the LP could not meet even with 1M penalty.
    if (lpFeasible && lpSolveAttempt.result) {
      const hardViolations = Object.entries(lpSolveAttempt.result)
        .filter(([k, v]) => k.startsWith('dev_hard_') && isFiniteNumber(toNumber(v, null)) && toNumber(v, 0) > 0.0001)
        .map(([k, v]) => `${k}=${round4(toNumber(v, 0))}`);
      if (hardViolations.length) {
        console.log(`[optimize] HARD constraint violations in LP solution: ${hardViolations.join(' ')}`);
      }
    }

    if (lpFeasible) {
      const lpFormula = buildOptimizedFormulaFromLpResult(
        ingredientVariableIds,
        ingredientsEnabled,
        lpSolveAttempt.result,
        context.formula_basis
      );
      console.log(`[optimize] lpFormula after build: count=${lpFormula.length} sum=${round4(lpFormula.reduce((s,r)=>s+r.inclusion,0))} items=${lpFormula.map(r=>`${r.id}:${r.inclusion}`).join(' ')}`);

      // Consolidate LP ghost inclusions: OR-Tools enforces sum=basis and may assign tiny
      // residuals to "excluded" macro/mineral ingredients. Only treat as ghost if the
      // ingredient is a bulk macro or mineral — never strip crystal AAs or micro additives
      // (salt, NaHCO₃, enzymes) which are legitimately small-dose ingredients.
      const _ghostThreshold = 0.5;
      const _ingMap = {};
      ingredientsEnabled.forEach(ing => { _ingMap[ing.id] = ing; });
      let _ghostSum = 0;
      const _cleanFormula = lpFormula.filter(row => {
        const ing = _ingMap[row.id];
        const role = ing ? ingredientRole(ing) : "macro";
        const hasMinBound = ing && isFiniteNumber(ing.min) && ing.min > 0.0001;
        // crystal (synthetic AAs), micro (salt, NaHCO₃, enzymes), and mineral (limestone, DCP, MCP)
        // are always real inclusions at any dose — never ghost them.
        const isProtected = role === "crystal" || role === "micro" || role === "mineral";
        const isGhost = !isProtected && row.inclusion < _ghostThreshold && !hasMinBound;
        if (isGhost) { _ghostSum = round4(_ghostSum + row.inclusion); return false; }
        return true;
      });
      if (_ghostSum > 0.001) {
        // Add ghost sum to the cheapest bulk macro already in the formula
        const _macroRow = _cleanFormula
          .filter(r => { const ing = _ingMap[r.id]; return ing && ingredientRole(ing) === "macro"; })
          .sort((a, b) => toNumber(_ingMap[a.id]?.cost, 99) - toNumber(_ingMap[b.id]?.cost, 99))[0];
        if (_macroRow) {
          _macroRow.inclusion = round4(_macroRow.inclusion + _ghostSum);
          _macroRow.cost_contribution = round4((_macroRow.inclusion / context.formula_basis) * toNumber(_macroRow.cost, 0));
          console.log(`[optimize] ghost consolidation: ${round4(_ghostSum)}% absorbed into ${_macroRow.display_name}`);
        }
      }
      // Replace lpFormula contents in-place using the cleaned version
      lpFormula.length = 0;
      _cleanFormula.forEach(r => lpFormula.push(r));

      // Pure LP (Bestmix/Brill): the LP result is the optimal solution. We only apply
      // mill snap (practical rounding to 0.1/0.01%) and a mass-balance top-up to ensure
      // the formula sums to exactly the basis. No post-LP mineral balancing, no synthetic
      // AA top-up, no hard-min repair — those are the LP's job, already solved above.
      const millSnap = applyMillSnapIfNotWorse(
        lpFormula,
        ingredientsEnabled,
        context.formula_basis,
        constraintsAll,
        nutrientMatrix
      );
      let snappedFormula = millSnap.formula || lpFormula;
      const _preSnapSum = round4(sumBy(snappedFormula, x => x.inclusion));
      console.log(`[optimize] pre-fill sum=${_preSnapSum} basis=${context.formula_basis} snap_applied=${millSnap.applied}`);
      snappedFormula = fillRemainingToBasis(
        snappedFormula,
        ingredientsEnabled,
        context.formula_basis,
        nutrientMatrix
      );
      const _postFillSum = round4(sumBy(snappedFormula, x => x.inclusion));
      console.log(`[optimize] post-fill sum=${_postFillSum} gap_closed=${round4(_postFillSum - _preSnapSum)}`);
      context._mill_snap = millSnap;

      const lpTotalInclusion = round4(sumBy(snappedFormula, x => x.inclusion));
      const lpRemainingGap = round4(Math.max(0, context.formula_basis - lpTotalInclusion));
      const lpTotalCost = round4(sumBy(snappedFormula, x => x.cost_contribution));

      optimizedFormula = snappedFormula;

      // ── Post-LP mineral + AA top-up ──────────────────────────────────────────
      // The LP optimises the full problem but may under-include minerals (Ca, AvP,
      // Na) because adding bulky minerals conflicts with the ME / CP macro space.
      // 1. balanceMineralsToSpecs: add limestone/DCP/salt by reducing the largest
      //    flexible macro (CORN002 etc.), honouring each ingredient's safety max.
      // 2. topUpSidWithSynthetics: after mineral adjustments, restore any SID AA
      //    shortfall with crystal inclusions by reducing the largest macro again.
      // This two-pass post-LP repair gives both minerals and synthetic AAs in the
      // final formula rather than being forced to choose between them.
      optimizedFormula = balanceMineralsToSpecs(
        optimizedFormula, ingredientsEnabled, constraintsAll, nutrientMatrix,
        context.formula_basis, context
      );
      optimizedFormula = topUpSidWithSynthetics(
        optimizedFormula, ingredientsEnabled, constraintsAll, nutrientMatrix,
        context.formula_basis
      );
      // ── End post-LP mineral + AA top-up ──────────────────────────────────────

      totalInclusion = round4(sumBy(optimizedFormula, x => x.inclusion));
      totalCostPerTon = round4(sumBy(optimizedFormula, x => x.cost_contribution));

      // Mass-balance safeguard (2026-07-21): the LP (with soft constraints / penalty
      // variables) can return a solution that slightly overshoots the basis equality.
      // Never emit a formula that sums to more than the basis — scale it back to
      // exactly the basis so the total inclusion is always <= 100%. Runs BEFORE the
      // nutrient results are computed so nutrients stay consistent with the formula.
      if (totalInclusion > context.formula_basis + 0.001 && totalInclusion <= context.formula_basis * 1.10) {
        const _bf = context.formula_basis / totalInclusion;
        optimizedFormula = optimizedFormula.map(x => ({
          ...x,
          inclusion: round4(x.inclusion * _bf),
          cost_contribution: round4(x.cost_contribution * _bf)
        }));
        // Absorb 4-decimal rounding residual into the largest ingredient so the
        // formula sums to EXACTLY the basis (e.g. exactly 1000 kg, not 999.998).
        if (optimizedFormula.length) {
          const _resid = round4(context.formula_basis - sumBy(optimizedFormula, x => x.inclusion));
          if (Math.abs(_resid) > 0) {
            let _maxI = 0;
            for (let i = 1; i < optimizedFormula.length; i++) {
              if (optimizedFormula[i].inclusion > optimizedFormula[_maxI].inclusion) _maxI = i;
            }
            optimizedFormula[_maxI].inclusion = round4(optimizedFormula[_maxI].inclusion + _resid);
          }
        }
        totalInclusion = round4(sumBy(optimizedFormula, x => x.inclusion));
        totalCostPerTon = round4(sumBy(optimizedFormula, x => x.cost_contribution));
        basisFeasibilityNotes.push(`Optimized formula scaled to basis (${context.formula_basis}%) to enforce mass balance.`);
      }

      solveDiagnostics = {
        at_min: ingredientsEnabled
          .filter(ing => {
            const row = lpFormula.find(x => x.id === ing.id);
            const inclusion = row ? row.inclusion : 0;
            return Math.abs(inclusion - ing.min) <= 0.0001;
          })
          .map(x => x.id),

        at_max: ingredientsEnabled
          .filter(ing => {
            const row = lpFormula.find(x => x.id === ing.id);
            const inclusion = row ? row.inclusion : 0;
            return Math.abs(inclusion - ing.max) <= 0.0001;
          })
          .map(x => x.id),

        excluded: ingredientsEnabled
          .filter(ing => {
            const row = lpFormula.find(x => x.id === ing.id);
            const inclusion = row ? row.inclusion : 0;
            return inclusion <= 0.0001;
          })
          .map(x => x.id),

        remaining_gap: lpRemainingGap
      };

      if (lpRemainingGap > 0.0001) {
        basisFeasibilityNotes.push(
          `LP solve returned formula with remaining inclusion gap: ${lpRemainingGap}`
        );
      }

      // Pure LP: compute nutrients directly from LP result. No post-LP repair.
      // Any unmet constraint is reported in constraintSatisfaction for the user to see.
      nutrientResults = calculateNutrientResultsFromFormula(
        optimizedFormula,
        nutrientMatrix,
        context.formula_basis
      );
      constraintSatisfaction = evaluateConstraintSatisfaction(constraintsAll, nutrientResults);
      finalSolveMode = "true_lp_with_penalties";
      lpObjectiveValue = toNumber(lpSolveAttempt.result?.result, null);

      // Log key amino acid results so we can see whether constraints were honored
      const aaKeys = ['sid_met','sid_metcys','sid_lys','sid_thr','sid_trp','sid_leu','cp','me'];
      const aaLog = aaKeys.map(k => `${k}=${round4(nutrientResults[k] ?? 0)}`).join(' ');
      const violated = constraintSatisfaction.filter(c => !c.satisfied).map(c => c.key).join(',');
      console.log(`[optimize] LP result: ${aaLog} | violated=${violated || 'none'} | mode=${finalSolveMode}`);

      // ── Enzyme iterative convergence ─────────────────────────────────────────
      // After first LP solve, check actual doses vs estimated. If > 0.001% deviation
      // for any enzyme, re-inject at actual doses and re-solve (max 5 iterations total).
      if (_hasEnzymes) {
        const MAX_ITER = 5;
        const CONV_TOL = 0.001; // % inclusion tolerance
        let _prevResult = lpSolveAttempt.result;
        let _curResult  = lpSolveAttempt.result;
        let _converged  = false;

        for (_enzymeConvIter = 1; _enzymeConvIter <= MAX_ITER && !_converged; _enzymeConvIter++) {
          // Extract actual doses from LP result
          const newDoseEstimates = {};
          let maxDelta = 0;
          for (const ingId of Object.keys(_enzymeCurveMap)) {
            const lpVal = toNumber(_curResult?.[ingId], 0);
            const actualDosePct = round4((lpVal / _basis) * 100);
            const prevDosePct   = _doseEstimates[ingId] ?? 0;
            newDoseEstimates[ingId] = actualDosePct;
            maxDelta = Math.max(maxDelta, Math.abs(actualDosePct - prevDosePct));
          }

          if (maxDelta < CONV_TOL) { _converged = true; break; }

          // Re-inject at new estimates
          _doseEstimates = newDoseEstimates;
          const { coeffs: _newCoeffs } = _applyEnzymeDosesToCoeffs(_doseEstimates);
          for (let i = 0; i < _newCoeffs.length; i++) {
            nutrientCoefficientsUsed[i].coefficients = _newCoeffs[i].coefficients;
          }

          // Rebuild nutrient matrix + deviation constraints + LP model
          for (const nutrientKey of requestedNutrientKeys) {
            nutrientCoefficientsUsed.forEach(row => {
              const coeff = row.coefficients?.[nutrientKey];
              nutrientMatrix[nutrientKey][row.requested_id] = isFiniteNumber(coeff) ? coeff : 0;
            });
          }
          applySyntheticPurityToMatrix(nutrientMatrix, ingredientsEnabled);
          applyOilFattyAcidsToMatrix(nutrientMatrix, ingredientsEnabled);

          const _iterDevBuild = buildDeviationVariables({
            constraintsAll, nutrientMatrix, formulaBasis: context.formula_basis, penalties: context.penalties
          });
          const _iterSolverRows = [
            ..._iterDevBuild.solver_rows,
            ...movementBuild.solver_rows,
            ...ratioLpRows
          ];
          const _iterVarBoundsMap = {
            ...ingredientBoundsMap,
            ..._iterDevBuild.variable_bounds_map,
            ...ratioBoundsMap
          };
          const _iterAllVarIds = Array.from(new Set([
            ...ingredientVariableIds,
            ...Object.keys(_iterDevBuild.variable_bounds_map || {}),
            ...ratioDevIds,
            ...Object.keys(movementBuild.variable_bounds_map || {})
          ]));
          const _iterCostVec = {
            ...objectiveBuild.objective_cost_vector,
            ..._iterDevBuild.variable_objective_map
          };
          for (const id of _iterAllVarIds) {
            if (!_iterCostVec[id]) _iterCostVec[id] = objectiveBuild.objective_cost_vector[id] ?? 0;
          }

          const _iterLpModel = buildJavascriptLpModel({
            allVariableIds: _iterAllVarIds,
            objectiveCostVector: _iterCostVec,
            variableBoundsMap: _iterVarBoundsMap,
            basisConstraint,
            solverReadyConstraints: _iterSolverRows
          });
          const _iterSolve = await solveWithJavascriptLp(_iterLpModel);
          if (_iterSolve?.ok && _iterSolve?.result) {
            _prevResult = _curResult;
            _curResult  = _iterSolve.result;
          } else {
            break; // convergence failed — keep previous result
          }
        }

        // Use converged result to rebuild final formula if it improved
        if (_curResult !== lpSolveAttempt.result) {
          const _convFormula = buildOptimizedFormulaFromLpResult(
            ingredientVariableIds, ingredientsEnabled, _curResult, context.formula_basis
          );
          if (_convFormula.length > 0) {
            optimizedFormula = _convFormula;
            totalInclusion  = round4(sumBy(optimizedFormula, x => x.inclusion));
            totalCostPerTon = round4(sumBy(optimizedFormula, x => x.cost_contribution));
            nutrientResults = calculateNutrientResultsFromFormula(optimizedFormula, nutrientMatrix, context.formula_basis);
            constraintSatisfaction = evaluateConstraintSatisfaction(constraintsAll, nutrientResults);
            lpRawResult = _curResult; // use converged result for objective breakdown
          }
        }

        // ── Substrate-level adjustment ──────────────────────────────────────
        // For xylanase/NSPase: compute wheat/barley fraction from converged formula,
        // scale ME release by substrate factor.
        const _substrateMeta = {};
        for (const ingId of Object.keys(_enzymeCurveMap)) {
          if (_enzymeSuppressed[ingId]) continue;
          const _subCoeffs = SUBSTRATE_COEFFICIENTS[ingId.toLowerCase()];
          if (!_subCoeffs) continue;

          let _substrateFactor = 0;
          let _substrateSources = {};
          for (const row of (optimizedFormula || [])) {
            const _idN = String(row.id || '').toLowerCase();
            for (const [substrate, multiplier] of Object.entries(_subCoeffs)) {
              if (_idN.includes(substrate)) {
                const _frac = (row.inclusion || 0) / _basis;
                _substrateFactor += _frac * multiplier;
                _substrateSources[substrate] = round4(_frac);
              }
            }
          }
          // Default substrate factor = 1 if no substrate matches (neutral)
          const _effectiveSubstrateFactor = _substrateFactor > 0 ? round4(_substrateFactor) : 1.0;

          if (Math.abs(_effectiveSubstrateFactor - 1.0) > 0.01) {
            // Re-evaluate ME release with substrate factor, update enzyme entry coefficients
            const _entry = nutrientCoefficientsUsed.find(e => e.requested_id === ingId);
            if (_entry && _entry.coefficients['me']) {
              const _rawMeRelease = _entry.coefficients['me'];
              _entry.coefficients['me'] = round4(_rawMeRelease * _effectiveSubstrateFactor);
            }
            if (_entry && _entry.coefficients['amen']) {
              _entry.coefficients['amen'] = round4(_entry.coefficients['amen'] * _effectiveSubstrateFactor);
            }
          }
          _substrateMeta[ingId] = { substrate_factor: _effectiveSubstrateFactor, sources: _substrateSources };
        }

        // ── Multi-enzyme synergy ─────────────────────────────────────────────
        // Super-additive bonus among single-family products only. Blends already
        // include intra-product synergy; stacking that bonus would double-count.
        const _presentEnzymes = Object.keys(_enzymeCurveMap).filter(id => {
          const lpVal = toNumber(_curResult?.[id], 0);
          return lpVal > 0.00001;
        });
        const _synergyCandidates = _presentEnzymes.filter(id => {
          const cls = _enzymeClassified[id];
          const src = creditSourceFor(id, _enzymeCreditSource);
          return cls && !cls.isBlend && !_enzymeSuppressed[id] && src === 'curve';
        });
        const _families = detectEnzymeFamilies(_synergyCandidates);
        const _synergyKey = getSynergyKey(_families);
        let _synergyMeta = null;

        if (_synergyKey && _families.length >= 2) {
          const _bonuses = SYNERGY_TABLE[_synergyKey];
          // Apply bonus as additional nutrient release, split evenly across synergy candidates
          const _enzymeCount = _synergyCandidates.length;
          for (const ingId of _synergyCandidates) {
            const _entry = nutrientCoefficientsUsed.find(e => e.requested_id === ingId);
            if (!_entry) continue;
            const curves = _enzymeCurveMap[ingId] || [];
            const _dosePct = _doseEstimates[ingId] ?? 0;
            for (const [bonusNut, bonusFrac] of Object.entries(_bonuses)) {
              const _nk = normalizeKey(bonusNut);
              if (_matrixBasisParsed.withEnzyme.has(_nk)) continue;
              // Only apply synergy bonus if this enzyme already contributes to this nutrient
              const _baseVal = _entry.coefficients[_nk];
              if (isFiniteNumber(_baseVal) && _baseVal > 0) {
                const _bonus = round4(_baseVal * bonusFrac / _enzymeCount);
                _entry.coefficients[_nk] = round4(_baseVal + _bonus);
              }
            }
          }
          // Final re-compute nutrient matrix with substrate + synergy applied
          for (const nutrientKey of requestedNutrientKeys) {
            nutrientCoefficientsUsed.forEach(row => {
              const coeff = row.coefficients?.[nutrientKey];
              nutrientMatrix[nutrientKey][row.requested_id] = isFiniteNumber(coeff) ? coeff : 0;
            });
          }
          applySyntheticPurityToMatrix(nutrientMatrix, ingredientsEnabled);
          applyOilFattyAcidsToMatrix(nutrientMatrix, ingredientsEnabled);
          nutrientResults = calculateNutrientResultsFromFormula(optimizedFormula, nutrientMatrix, context.formula_basis);
          constraintSatisfaction = evaluateConstraintSatisfaction(constraintsAll, nutrientResults);

          _synergyMeta = {
            key: _synergyKey,
            families: _families,
            bonuses: _bonuses,
            enzymes_present: _synergyCandidates
          };
        }

        // ── Build final enzymeResponseMeta ───────────────────────────────────
        const { appliedMeta: _finalApplied } = _applyEnzymeDosesToCoeffs(_doseEstimates);
        for (const [ingId, info] of Object.entries(_finalApplied)) {
          const _actualDosePct = _doseEstimates[ingId] ?? info.dosePct;
          const _cls = _enzymeClassified[ingId] || {};
          enzymeResponseMeta[ingId] = {
            display_name: ingredientsEnabled.find(x => x.id === ingId)?.display_name || ingId,
            dose_estimated_pct: round4(info.dosePct),
            dose_actual_pct: round4(_actualDosePct),
            dose_converged: _converged,
            convergence_iterations: _enzymeConvIter,
            dose_unit: 'inclusion_pct',
            effective_nutrients: info.effectiveNutrients,
            substrate_adjustment: _substrateMeta[ingId] || null,
            is_blend: !!_cls.isBlend,
            families: _cls.families || [],
            skipped: !!info.skipped,
            skip_reason: info.skip_reason || null,
            credit_source: info.credit_source || creditSourceFor(ingId, _enzymeCreditSource),
            covering_blend: info.covering_blend || null,
            skipped_nutrients: info.skipped_nutrients || [],
            curves_applied: (info.curves || []).map(c => ({
              nutrient_key: c.nutrient_key,
              curve_name: c.curve_name,
              model_type: c.model_type || 'breakpoints'
            }))
          };
        }
        enzymeResponseMeta._synergy = _synergyMeta;
      }
      // ── End enzyme convergence / substrate / synergy ──────────────────────
       } else {
      // LP solver failed outright (extremely rare after penalised-constraint change).
      // Use a simple greedy least-cost fill as emergency fallback — no post-LP hacks.
      const greedy = buildGreedyLeastCostBasisSolution(ingredientsEnabled, context.formula_basis);
      let fallback = greedy.optimizedFormula || [];
      if (lpHasDecisionValues) {
        fallback = buildOptimizedFormulaFromLpResult(
          ingredientVariableIds,
          ingredientsEnabled,
          lpSolveAttempt.result,
          context.formula_basis
        );
      }
      fallback = fillRemainingToBasis(fallback, ingredientsEnabled, context.formula_basis, nutrientMatrix);
      optimizedFormula = fallback;
      totalInclusion = round4(sumBy(optimizedFormula, (x) => x.inclusion));
      totalCostPerTon = round4(sumBy(optimizedFormula, (x) => x.cost_contribution));
      nutrientResults = calculateNutrientResultsFromFormula(
        optimizedFormula,
        nutrientMatrix,
        context.formula_basis
      );
      constraintSatisfaction = evaluateConstraintSatisfaction(constraintsAll, nutrientResults);
      solveDiagnostics = {
        at_min: [],
        at_max: [],
        excluded: [],
        remaining_gap: round4(Math.max(0, context.formula_basis - totalInclusion)),
        reason: "LP_INFEASIBLE_HUNDRED_PLUS_SYNTHETICS",
        notes: basisFeasibilityNotes || [],
        lp_status: lpSolveAttempt?.status || null
      };
      finalSolveMode = "hundred_plus_synthetics";
      lpObjectiveValue = null;
    }

    const hardFailures = constraintSatisfaction.filter(
      x => normalizeKey(x.hardness || "hard") !== "soft" && x.status === "FAIL"
    );

    const feasible =
      finalSolveMode === "true_lp_with_penalties"
        ? hardFailures.length === 0
        : finalSolveMode === "hundred_plus_synthetics"
        ? hardFailures.length === 0
        : (
            basisFeasibilityNotes.length === 0 &&
            hardFailures.length === 0
          );

    const solveTimeMs = Date.now() - startedAt;

    const costSummary = {
      total_cost_per_ton: totalCostPerTon,
      currency: "USD",
      cost_basis: "per_metric_ton"
    };

    const gainObjectiveMetrics = buildGainObjectiveMetrics(
      context,
      costSummary,
      !!(profitLpMeta && profitLpMeta.true_lp_objective)
    );

    let profitCompare = null;
    if (profitLpMeta?.true_lp_objective && lpFeasible && optimizedFormula?.length) {
      try {
        profitCompare = await buildProfitCompare({
          javascriptLpModel,
          ingredientCostVector,
          ingredientVariableIds,
          ingredientsEnabled,
          formulaBasis: context.formula_basis,
          profitFormula: optimizedFormula,
          profitCostPerKg: totalCostPerTon,
          context,
        });
      } catch (err) {
        profitCompare = { available: false, note: err?.message || "Comparison failed." };
      }
    }

    const startingFormulaComparison = buildStartingFormulaComparison(
      body.starting_formula,
      optimizedFormula,
      ingredientsEnabled
    );

    const inclusionDelta = buildInclusionDelta(startingFormulaComparison);

    const costDelta = buildCostDelta(
      body.starting_formula,
      optimizedFormula,
      ingredientsEnabled,
      context.formula_basis
    );

    const nutrientDelta = buildNutrientDelta(
      body.starting_formula,
      optimizedFormula,
      nutrientMatrix,
      constraintsAll,
      context.formula_basis
    );

    const bindingConstraints = buildBindingConstraints(constraintsAll, nutrientResults);
    const nutrientSlack = buildNutrientSlack(constraintsAll, nutrientResults);
    const ingredientBoundStatus = buildIngredientBoundStatus(ingredientsEnabled, optimizedFormula);

    const optimizationSummary = buildOptimizationSummary({
      optimizedFormula,
      costSummary,
      bindingConstraints,
      ingredientBoundStatus,
      inclusionDelta
    });

    const objectiveBreakdownResult =
      finalSolveMode === "true_lp_with_penalties"
        ? buildObjectiveBreakdownFromLpResult({
            lpRawResult,
            ingredientVariableIds,
            objectiveCostVector: objectiveBuild.objective_cost_vector,
            formulaBasis: context.formula_basis
          })
        : {
            ingredient_cost_component: null,
            deviation_penalty_component: null,
            movement_penalty_component: null,
            total_objective_value: null,
            rows: []
          };

    const penaltyUsage =
      finalSolveMode === "true_lp_with_penalties"
        ? buildPenaltyUsageDiagnostics({
            lpRawResult,
            objectiveCostVector: objectiveBuild.objective_cost_vector
          })
        : {
            active_penalty_variables_count: 0,
            active_deviation_variables_count: 0,
            active_movement_variables_count: 0,
            deviation_rows: [],
            movement_rows: []
          };

    const economicDriverSummary = buildEconomicDriverSummary({
      bindingConstraints,
      ingredientBoundStatus,
      inclusionDelta,
      objectiveBreakdownResult,
      penaltyUsage
    });

    const objectiveBreakdownPerTon =
      finalSolveMode === "true_lp_with_penalties"
        ? buildObjectiveBreakdownPerTon(
            objectiveBreakdownResult,
            context.formula_basis
          )
        : {
            basis: context.formula_basis,
            ingredient_cost_component_per_ton: null,
            deviation_penalty_component_per_ton: null,
            movement_penalty_component_per_ton: null,
            total_objective_value_per_ton: null
          };

    const ingredientMovementReasonEngine = buildIngredientMovementReasonEngine({
      inclusionDelta,
      ingredientBoundStatus,
      bindingConstraints,
      penaltyUsage,
      nutrientSlack
    });

    const economicPressureSummary = buildEconomicPressureSummary({
      objectiveBreakdownPerTon,
      penaltyUsage,
      economicDriverSummary,
      bindingConstraints,
      ingredientBoundStatus
    });

    const constraintSensitivityCases = buildConstraintSensitivityCases(constraintsAll);

    const constraintSensitivitySummary = buildConstraintSensitivitySummary({
      baseObjectivePerTon: objectiveBreakdownPerTon,
      constraintSatisfaction,
      economicPressureSummary
    });

    const selectedSensitivityCases = buildSelectedSensitivityCases(
      constraintSensitivityCases
    );

    const sensitivityPerturbationPass = await computeNutrientShadowPrices({
      constraintsAll,
      nutrientResults,
      context,
      ingredientVariableIds,
      nutrientMatrix,
      ingredientBoundsMap,
      basisConstraint,
      objectiveBuild,
      extraSolverRows: [
        ...(movementBuild?.solver_rows || []),
        ...(ratioLpRows || [])
      ],
      baseIngredientCostPerUnit: toNumber(costSummary?.total_cost_per_ton, null),
      lpRawResult
    });

    const baseObjectivePerTon = toNumber(objectiveBreakdownPerTon?.total_objective_value_per_ton, null);

    // Ingredient-level shadow prices — only for LP mode (no meaningful bound shadow in greedy mode)
    const ingredientShadowPrices = finalSolveMode === 'true_lp_with_penalties'
      ? await computeIngredientShadowPrices({
          ingredientBoundStatus,
          constraintsAll,
          context,
          ingredientVariableIds,
          ingredientsEnabled,
          nutrientMatrix,
          ingredientBoundsMap,
          basisConstraint,
          objectiveBuild,
          baseObjectivePerTon,
          lpRawResult
        })
      : [];

    const sensitivityPerturbationRows = (sensitivityPerturbationPass?.rows || []).map(row => ({
      ...row,
      weight_unit: context.weight_unit,
      ton_label: shadowTonMultiplier(context.weight_unit) === 2000 ? "short ton" : "tonne",
      base_ingredient_cost_per_ton: perFeedUnitToPerTon(
        toNumber(costSummary?.total_cost_per_ton, null),
        context.weight_unit
      )
    }));

    const solverStatus = {
  termination:
    finalSolveMode === "true_lp_with_penalties"
      ? (feasible ? "lp_optimal_or_feasible" : "lp_infeasible_or_failed")
      : finalSolveMode === "lp_infeasible_no_fallback"
      ? "lp_infeasible_no_fallback"
      : (feasible ? "basis_only_greedy" : "basis_only_infeasible"),
  feasible,
  infeasible: !feasible,
  method:
    finalSolveMode === "true_lp_with_penalties"
      ? (lpSolveAttempt?.engine || solverPoolInfo().engine || "native_lp")
      : finalSolveMode === "lp_infeasible_no_fallback"
      ? "none"
      : "greedy_least_cost_basis_fill",
  engine: lpSolveAttempt?.engine || solverPoolInfo().engine || null,
  bounds: "native_variable_bounds",
  solve_time_ms: solveTimeMs
};

    // Collect hard constraint violations from LP solution (dev_hard_* variables).
    const lpHardViolations = lpFeasible && lpSolveAttempt.result
      ? Object.entries(lpSolveAttempt.result)
          .filter(([k, v]) => k.startsWith('dev_hard_') && isFiniteNumber(toNumber(v, null)) && toNumber(v, 0) > 0.0001)
          .map(([k, v]) => ({
            variable: k,
            violation: round4(toNumber(v, 0)),
            nutrient: k.replace(/^dev_hard_(low|high)__/, '').replace(/_/g, '.'),
            type: k.includes('_low__') ? 'below_min' : 'above_max'
          }))
      : [];

    const infeasibilityDiagnostics = buildInfeasibilityDiagnostics({
      basisFeasibilityNotes,
      constraintSatisfaction,
      solverStatus,
      lpSolveAttempt,
      lpHardViolations
    });

    // Compute proximate observation nutrients (dm, cf, ee, ash, etc.) that were
    // not part of the LP constraints.  The frontend "Fix 3" reads nutrient_profile
    // to fill optimized_actual for unconstrained rows.
    const ingredientsEnabledById = Object.fromEntries(ingredientsEnabled.map(x => [x.id, x]));
    const observationProfile = feasible
      ? computeObservationProfile(optimizedFormula, ingredientDb, context.formula_basis, requestedNutrientKeys, ingredientsEnabledById)
      : {};
    const nutrientProfile = { ...nutrientResults, ...observationProfile };
    const dmMoistFinal = computeFormulaDmMoisture(optimizedFormula, ingredientsEnabledById);
    if (dmMoistFinal) {
      nutrientProfile.dm = dmMoistFinal.dm;
      nutrientProfile.moisture = dmMoistFinal.moisture;
    } else {
      delete nutrientProfile.dm;
      delete nutrientProfile.moisture;
    }

    // AIE — Log optimization event
    try {
      const AIE = require("../../../core/intelligence/AIE.cjs");
      AIE.onFormulaOptimized({
        species: req.body?.species,
        type: req.body?.type,
        production: req.body?.production,
        body_weight_kg: req.body?.body_weight_kg,
        intake_pct_bw: req.body?.intake_pct_bw,
        work_level: req.body?.work_level,
        optimization_mode: req.body?.optimization_mode,
        feasible,
        cost_per_ton: finalCostPerTon ?? null,
        formula_rows: ingredient_pool || [],
        nutrient_profile: nutrientProfile
      });
    } catch (_aieErr) {}

    return res.json({
      status: feasible ? "optimal" : "infeasible",
      objective: context.objective,
      message:
  finalSolveMode === "true_lp_with_penalties"
    ? (profitLpMeta?.true_lp_objective
        ? "Profit-adjusted LP solution generated. Mix can differ from least-cost. True feed cost and IOFC use your farm FCR or milk price."
        : "True LP least-cost solution generated successfully with deviation and movement penalties.")
    : finalSolveMode === "lp_infeasible_no_fallback"
    ? "No feasible formulation found. Adjust nutrient constraints, ingredient bounds, or allowed ingredients."
    : feasible
    ? "Least-cost basis solution generated successfully. Nutrient coefficient extraction completed."
    : "Least-cost solution could not be generated.",

      context: {
        locale: context.locale,
        species: context.species,
        type: context.type,
        production: context.production,
        breed: context.breed,
        phase: context.phase,
        region: context.region,
        version: context.version,
        formula_basis: context.formula_basis,
        cp_apply_mode: context.cp_apply_mode,
        penalties: context.penalties,
        gain_data: context.gain_data
      },

      gain_objective_metrics: gainObjectiveMetrics,
      profit_lp_meta: profitLpMeta,
      profit_compare: profitCompare,
      enzyme_response: (() => {
        const enzymes = Object.fromEntries(Object.entries(enzymeResponseMeta).filter(([k]) => k !== '_synergy'));
        const applied = Object.keys(enzymes).length > 0;
        const guards = _hasEnzymes ? {
          matrix_basis: _matrixBasisParsed.basis,
          credit_source: _enzymeCreditSource,
          suppressed_by_blend: _enzymeSuppressed,
          skipped_nutrients: [..._matrixBasisParsed.withEnzyme]
        } : null;
        return applied
          ? {
              applied: true,
              enzymes,
              synergy: enzymeResponseMeta._synergy || null,
              guards,
              convergence_note: enzymeResponseMeta._synergy ? `Converged in ${Object.values(enzymeResponseMeta).find(v => v?.convergence_iterations != null)?.convergence_iterations ?? '?'} iteration(s)` : null
            }
          : { applied: false, enzymes: {}, synergy: null, guards };
      })(),

      optimizer_input_summary: {
        ingredient_count_total: ingredientsAll.length,
        ingredient_count_enabled: ingredientsEnabled.length,
        nutrient_constraint_count: constraintsAll.length,
        total_min_inclusion_enabled: totalMin,
        total_max_inclusion_enabled: totalMax
      },

      optimizer_inputs_normalized: {
        ingredient_pool_enabled: clone(ingredientsEnabled),
        nutrient_constraints: clone(constraintsAll),
        locked_ingredients: Array.isArray(body.locked_ingredients) ? clone(body.locked_ingredients) : [],
        starting_formula: Array.isArray(body.starting_formula) ? clone(body.starting_formula) : []
      },

      optimizer_model: {
        variable_ids: objectiveBuild.all_variable_ids,
        ingredient_variable_ids: ingredientVariableIds,
        objective: context.objective,
        basis_target: context.formula_basis,
        ingredient_bounds: ingredientsEnabled.map(x => ({
          id: x.id,
          min: x.min,
          max: x.max,
          cost: x.cost
        })),
        cost_vector: Object.entries(objectiveBuild.objective_cost_vector).map(([id, cost]) => ({
          id,
          cost
        })),
        nutrient_constraint_keys: requestedNutrientKeys,
        objective_breakdown: objectiveBuild.objective_breakdown
      },

      optimizer_lp_model: optimizerLpModel,
      solver_ready_constraints: solverReadyConstraints,
      javascript_lp_model: javascriptLpModel,

      lp_solver_attempt: {
        attempted: basisFeasibilityNotes.length === 0,
        solver_loaded: !!lpSolverModule,
        status: lpSolveAttempt.status,
        message: lpSolveAttempt.message,
        objective_value: lpObjectiveValue,
        solve_mode_used: finalSolveMode,
        raw_result: lpRawResult
      },

      practical_controls: practicalControls,

      deviation_variables: deviationBuild.diagnostics,
      movement_variables: movementBuild.diagnostics,

      ingredient_resolution: {
        loader_ok: loaderResult.ok,
        loader_error: loaderResult.error,
        loader_path: ingredientsLoaderPath,
        resolved_count: ingredientResolutionItems.filter(x => x.resolved).length,
        unresolved_count: ingredientResolutionItems.filter(x => !x.resolved).length,
        items: ingredientResolutionItems
      },

      nutrient_coefficients_used: nutrientCoefficientsUsed,

      missing_nutrient_coefficients: {
        count: missingNutrientCoefficientItems.length,
        items: missingNutrientCoefficientItems
      },

      canonical_fills: context._canonical_fill_log || [],

      optimizer_matrix_summary: {
        ingredients_enabled: ingredientsEnabled.length,
        nutrient_keys_requested: requestedNutrientKeys.length,
        matrix_cells_expected: matrixCellsExpected,
        matrix_cells_with_values: matrixCellsWithValues,
        matrix_cells_missing: matrixCellsMissing
      },

      nutrient_results: nutrientResults,
      nutrient_profile: nutrientProfile,
      constraint_satisfaction: constraintSatisfaction,

      starting_formula_comparison: startingFormulaComparison,
      inclusion_delta: inclusionDelta,
      cost_delta: costDelta,
      nutrient_delta: nutrientDelta,

      binding_constraints: bindingConstraints,
      nutrient_slack: nutrientSlack,
      ingredient_bound_status: ingredientBoundStatus,
      optimization_summary: optimizationSummary,
      objective_breakdown_result: objectiveBreakdownResult,
      penalty_usage: penaltyUsage,
      economic_driver_summary: economicDriverSummary,
      objective_breakdown_per_ton: objectiveBreakdownPerTon,
      ingredient_movement_reason_engine: ingredientMovementReasonEngine,
      economic_pressure_summary: economicPressureSummary,
      constraint_sensitivity_cases: constraintSensitivityCases,
      constraint_sensitivity_summary: constraintSensitivitySummary,
      selected_sensitivity_cases: selectedSensitivityCases,
      sensitivity_perturbation_rows: sensitivityPerturbationRows,
      ingredient_shadow_prices: ingredientShadowPrices,
      infeasibility_diagnostics: infeasibilityDiagnostics,

      formula_summary: {
        basis_target: context.formula_basis,
        basis_precheck_passed: totalMin <= context.formula_basis && totalMax >= context.formula_basis,
        total_inclusion: totalInclusion,
        normalized_to_basis: Math.abs(totalInclusion - context.formula_basis) <= 0.01,
        nonzero_ingredient_count: optimizedFormula.length
      },

      cost_summary: costSummary,
      optimized_formula: optimizedFormula,

      constraint_diagnostics: {
        nutrient_constraints_loaded: constraintsAll.length,
        nutrient_constraints_applied:
          finalSolveMode === "true_lp_with_penalties" ? solverReadyConstraints.length : 0,
        hard_failures_count: hardFailures.length,
        soft_warnings_count: constraintSatisfaction.filter(x => x.status === "WARN").length,
        note:
          finalSolveMode === "true_lp_with_penalties"
            ? "Hard constraints were enforced; soft constraints and targets were handled using deviation penalties; movement penalties were also active when starting_formula was provided."
            : "Nutrient constraints loaded and coefficients extracted, but fallback solve was used."
      },

      ingredient_diagnostics: {
        at_min: solveDiagnostics.at_min,
        at_max: solveDiagnostics.at_max,
        excluded: solveDiagnostics.excluded,
        locked: Array.isArray(body.locked_ingredients) ? clone(body.locked_ingredients) : []
      },

      comparison_vs_input: {
        has_starting_formula: Array.isArray(body.starting_formula) && body.starting_formula.length > 0,
        note: "Comparison engine active for inclusion, nutrient, cost, and movement penalty diagnostics."
      },

      solver_status: solverStatus,
      feasibility_notes: basisFeasibilityNotes,
      economic_least_cost: {
        std_is_pull: true,
        mill_snap_applied: !!(context._mill_snap && context._mill_snap.applied),
        mill_snap_delta_per_kg: context._mill_snap ? context._mill_snap.delta : null,
        shadows_from: sensitivityPerturbationPass?.source || "perturbation"
      },

      nutrient_matrix: nutrientMatrix,
      ingredient_display_names: Object.fromEntries(
        (nutrientCoefficientsUsed || []).map(r => [r.requested_id, r.ingredient_name || r.requested_id])
      ),

      meta: {
        engine: "AgroCore",
        module: "optimizer_v1",
        stage: finalSolveMode === "true_lp_with_penalties"
          ? "true_lp_solve_with_deviation_and_movement_penalties"
          : "basis_only_solve_plus_coefficient_extraction",
        optimizer_mode: finalSolveMode === "true_lp_with_penalties"
          ? "least_cost_true_lp_with_penalties"
          : "least_cost_basis_only",
        analyzer_postcheck_used: false,
        timestamp_utc: new Date().toISOString()
      }
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: err?.message || "Optimizer route failed",
      meta: {
        engine: "AgroCore",
        module: "optimizer_v1",
        stage: "runtime_error",
        timestamp_utc: new Date().toISOString()
      }
    });
  }
});

// ── POST /v1/optimize/stochastic ─────────────────────────────────────────────
// Accepts a pre-built javascript-lp-solver model (from a prior /v1/optimize
// response's `javascript_lp_model` field) and runs Monte Carlo LP re-solves
// with Gaussian-perturbed nutrient coefficients to produce a cost distribution.
const monteCarloRisk = require("../../../core/optimizer/stochastic/monteCarloRisk.cjs");

router.post("/v1/optimize/stochastic", requireModule("stochastic"), async (req, res) => {
  try {
    const body = req.body || {};
    const lpModel = body.lp_model;
    const ingredientIds = body.ingredient_ids;
    const scenarios = Math.min(Math.max(toNumber(body.scenarios, 300), 50), 1000);
    const confidence = Math.min(Math.max(toNumber(body.confidence, 0.95), 0.5), 0.99);
    const nutrientVariancePct = Math.min(Math.max(toNumber(body.nutrient_variance_pct, 0.05), 0.005), 0.25);

    if (!lpModel || typeof lpModel !== "object") {
      return res.status(400).json({ ok: false, error: "lp_model is required (pass javascript_lp_model from a prior /v1/optimize response)" });
    }
    if (!Array.isArray(ingredientIds) || !ingredientIds.length) {
      return res.status(400).json({ ok: false, error: "ingredient_ids is required (pass optimizer_model.ingredient_variable_ids from a prior /v1/optimize response)" });
    }

    if (!lpSolverModule) loadLpSolverModule();

    const result = await monteCarloRisk({
      lpModel,
      ingredientIds,
      scenarios,
      confidence,
      nutrientVariancePct,
      lpSolver: lpSolverModule,
      solveFn: solveWithJavascriptLp,
      concurrency: solverPoolInfo().workers || 4
    });

    return res.json({
      ok: result.status === "OK" || result.status === "NO_FEASIBLE_SCENARIOS",
      stochastic: result,
      meta: {
        engine: "AgroCore",
        module: "stochastic_v1",
        timestamp_utc: new Date().toISOString()
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
      meta: { engine: "AgroCore", module: "stochastic_v1", stage: "runtime_error" }
    });
  }
});

async function solveDietAtCosts({
  ingredients,
  constraintsAll,
  formulaBasis,
  nutrientMatrix,
  ingredientVariableIds
}) {
  if (!lpSolverModule) loadLpSolverModule();
  const stepCostVector = {};
  const stepBoundsMap = {};
  ingredients.forEach(ing => {
    stepCostVector[ing.id] = ing.cost;
    stepBoundsMap[ing.id] = { min: ing.min, max: ing.max };
  });
  const stepDevBuild = buildDeviationVariables({
    constraintsAll,
    nutrientMatrix,
    formulaBasis,
    penalties: { nutrient_low: 20000, nutrient_high: 20000, nutrient_target: 2000 }
  });
  const stepObjectiveBuild = buildObjectiveFunction({
    ingredientIds: ingredientVariableIds,
    ingredientCostVector: stepCostVector,
    deviationBuild: stepDevBuild,
    movementBuild: { variable_ids: [], variable_bounds_map: {}, variable_objective_map: {}, solver_rows: [] }
  });
  const stepVarBoundsMap = { ...stepBoundsMap, ...stepDevBuild.variable_bounds_map };
  const stepBasisConstraint = {
    type: "equality",
    coefficients: ingredientVariableIds.reduce((a, id) => { a[id] = 1; return a; }, {}),
    rhs: formulaBasis
  };
  const stepLpModel = buildJavascriptLpModel({
    allVariableIds: stepObjectiveBuild.all_variable_ids,
    objectiveCostVector: stepObjectiveBuild.objective_cost_vector,
    variableBoundsMap: stepVarBoundsMap,
    basisConstraint: stepBasisConstraint,
    solverReadyConstraints: stepDevBuild.solver_rows
  });
  const solve = await solveWithJavascriptLp(stepLpModel);
  const lpInfeasible = solve?.result?.feasible === false || solve?.result?.result === "Infeasible";
  const lpObjRaw = toNumber(solve?.result?.result, null);
  const hasObj = isFiniteNumber(lpObjRaw);
  const hasDecisionVals = !!solve?.result && ingredientVariableIds.some(id => isFiniteNumber(toNumber(solve.result[id], null)));
  const feasible = !!solve?.ok && !lpInfeasible && (hasObj || hasDecisionVals);
  const inclusionById = {};
  if (feasible && solve?.result) {
    for (const id of ingredientVariableIds) {
      inclusionById[id] = toNumber(solve.result[id], 0);
    }
  }
  return { feasible, inclusionById };
}

// ── POST /v1/optimize/sensitivity ────────────────────────────────────────────
// Same JS LP as Optimize / Parametric. Unused ingredients get an entry price
// by binary-searching cost until the diet includes them (or 0 = constraint-blocked).
router.post("/v1/optimize/sensitivity", async (req, res) => {
  try {
    const body = req.body || {};

    if (!Array.isArray(body.ingredient_pool) || body.ingredient_pool.length === 0) {
      return res.status(400).json({ ok: false, error: "ingredient_pool required" });
    }
    if (!Array.isArray(body.nutrient_constraints) || body.nutrient_constraints.length === 0) {
      return res.status(400).json({ ok: false, error: "nutrient_constraints required" });
    }

    if (!lpSolverModule) loadLpSolverModule();
    if (!lpSolverModule) {
      return res.status(500).json({ ok: false, error: "javascript-lp-solver is not available" });
    }

    const formulaBasis = toNumber(body.formula_basis, 100);
    const ingredientsEnabled = body.ingredient_pool.map(validateIngredient).map(x => x.normalized).filter(x => x.enabled !== false);
    const constraintsAll = body.nutrient_constraints.map(validateConstraint).map(x => x.normalized);

    const context = {
      locale: body.locale || "US",
      species: body.species || null,
      type: body.type || null,
      region: body.region || "us",
      version: body.version || "v1",
    };

    const loaderResult = loadIngredientDbForContext(context);
    const ingredientDb = loaderResult.db || {};
    const requestedNutrientKeys = constraintsAll.map(x => x.key);

    const nutrientCoeffsUsed = [];
    for (const ing of ingredientsEnabled) {
      const resolved = resolveIngredientRecord(ingredientDb, ing.id, ing.display_name);
      const coeffs = {};
      for (const nk of requestedNutrientKeys) {
        const payloadVal = getNutrientValueForKey(ing, nk);
        const dbVal = resolved ? getNutrientValueForKey(resolved.row, nk) : null;
        const val = isFiniteNumber(payloadVal) ? payloadVal : dbVal;
        if (isFiniteNumber(val)) coeffs[nk] = val;
      }
      nutrientCoeffsUsed.push({ id: ing.id, coefficients: coeffs });
    }

    const nutrientMatrix = {};
    for (const nk of requestedNutrientKeys) {
      nutrientMatrix[nk] = {};
      for (const nc of nutrientCoeffsUsed) {
        nutrientMatrix[nk][nc.id] = isFiniteNumber(nc.coefficients[nk]) ? nc.coefficients[nk] : 0;
      }
    }

    const ingredientVariableIds = ingredientsEnabled.map(x => x.id);
    const solveOpts = { constraintsAll, formulaBasis, nutrientMatrix, ingredientVariableIds };

    const baseSolve = await solveDietAtCosts({ ...solveOpts, ingredients: ingredientsEnabled });
    if (!baseSolve.feasible) {
      return res.status(200).json({
        ok: false,
        error: "Last Optimize was infeasible. Relax min/max or targets, Optimize, then analyze rejected items."
      });
    }

    const ZERO_THRESHOLD = 0.001;
    const rejected = [];

    for (const ing of ingredientsEnabled) {
      if (toNumber(baseSolve.inclusionById[ing.id], 0) > ZERO_THRESHOLD) continue;

      const currentPrice = toNumber(ing.cost, 0);
      const atZero = await solveDietAtCosts({
        ...solveOpts,
        ingredients: ingredientsEnabled.map(x => x.id === ing.id ? { ...x, cost: 0 } : x)
      });
      const usedFree = atZero.feasible && toNumber(atZero.inclusionById[ing.id], 0) > ZERO_THRESHOLD;

      if (!usedFree) {
        rejected.push({
          name: ing.display_name || ing.id,
          current_price: currentPrice,
          entry_price: null,
          reason: "constraints"
        });
        continue;
      }

      let lo = 0;
      let hi = Math.max(currentPrice, 1e-6);
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        const trial = await solveDietAtCosts({
          ...solveOpts,
          ingredients: ingredientsEnabled.map(x => x.id === ing.id ? { ...x, cost: mid } : x)
        });
        const used = trial.feasible && toNumber(trial.inclusionById[ing.id], 0) > ZERO_THRESHOLD;
        if (used) lo = mid;
        else hi = mid;
      }

      rejected.push({
        name: ing.display_name || ing.id,
        current_price: currentPrice,
        entry_price: round4(lo),
        reason: "price"
      });
    }

    return res.json({
      ok: true,
      solver_status: "OPTIMAL",
      rejected,
      meta: { engine: "AgroCore", module: "sensitivity_v1", timestamp_utc: new Date().toISOString() }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// ── POST /v1/optimize/parametric ─────────────────────────────────────────────
// Re-runs the JS LP N times varying one parameter (nutrient_min/max, ingredient_price/max).
// Returns an array of run results so the frontend can plot cost vs. parameter.
router.post("/v1/optimize/parametric", async (req, res) => {
  try {
    const body = req.body || {};
    const formulaPayload = body.formula_payload;
    const vary = body.vary; // { type, key, from, to, steps }

    if (!formulaPayload || typeof formulaPayload !== "object") {
      return res.status(400).json({ ok: false, error: "formula_payload required" });
    }
    if (!vary || !vary.type) {
      return res.status(400).json({ ok: false, error: "vary.{type} required" });
    }
    const hasValues = Array.isArray(vary.values) && vary.values.length >= 1;
    if (!hasValues && (vary.from == null || vary.to == null)) {
      return res.status(400).json({ ok: false, error: "vary.{from,to} or vary.values required" });
    }

    const numSteps = hasValues
      ? Math.min(Math.max(vary.values.length, 1), 20)
      : Math.min(Math.max(toNumber(vary.steps, 5), 2), 20);
    const fromVal = toNumber(vary.from, 0);
    const toVal = toNumber(vary.to, 0);
    const varyKey = vary.key || null;
    const varyType = vary.type; // nutrient_min | nutrient_max | ingredient_price | ingredient_max

    if (!lpSolverModule) loadLpSolverModule();

    // Parse base formula payload (reuse same validation as /v1/optimize)
    const baseIngredients = Array.isArray(formulaPayload.ingredient_pool)
      ? formulaPayload.ingredient_pool.map(validateIngredient).map(x => x.normalized).filter(x => x.enabled !== false)
      : [];
    const baseConstraints = Array.isArray(formulaPayload.nutrient_constraints)
      ? formulaPayload.nutrient_constraints.map(validateConstraint).map(x => x.normalized)
      : [];
    const formulaBasis = toNumber(formulaPayload.formula_basis, 100);

    const context = {
      locale: formulaPayload.locale || "US",
      species: formulaPayload.species || null,
      type: formulaPayload.type || null,
      region: formulaPayload.region || "us",
      version: formulaPayload.version || "v1",
    };

    const loaderResult = loadIngredientDbForContext(context);
    const ingredientDb = loaderResult.db || {};
    const requestedNutrientKeys = baseConstraints.map(x => x.key);

    // Build base nutrient matrix
    const nutrientCoeffsUsed = [];
    for (const ing of baseIngredients) {
      const resolved = resolveIngredientRecord(ingredientDb, ing.id, ing.display_name);
      const coeffs = {};
      for (const nk of requestedNutrientKeys) {
        const payloadVal = getNutrientValueForKey(ing, nk);
        const dbVal = resolved ? getNutrientValueForKey(resolved.row, nk) : null;
        const val = isFiniteNumber(payloadVal) ? payloadVal : dbVal;
        if (isFiniteNumber(val)) coeffs[nk] = val;
      }
      nutrientCoeffsUsed.push({ id: ing.id, display_name: ing.display_name, cost: ing.cost, min: ing.min, max: ing.max, coefficients: coeffs });
    }

    const baseNutrientMatrix = {};
    for (const nk of requestedNutrientKeys) {
      baseNutrientMatrix[nk] = {};
      for (const nc of nutrientCoeffsUsed) {
        baseNutrientMatrix[nk][nc.id] = isFiniteNumber(nc.coefficients[nk]) ? nc.coefficients[nk] : 0;
      }
    }

    const ingredientVariableIds = baseIngredients.map(x => x.id);

    // Helper: build + solve one LP step
    async function solveStep(stepIngredients, stepConstraints) {
      const stepCostVector = {};
      const stepBoundsMap = {};
      stepIngredients.forEach(ing => {
        stepCostVector[ing.id] = ing.cost;
        stepBoundsMap[ing.id] = { min: ing.min, max: ing.max };
      });

      // Build deviation variables for hard constraints
      const stepDevBuild = buildDeviationVariables({
        constraintsAll: stepConstraints,
        nutrientMatrix: baseNutrientMatrix,
        formulaBasis: formulaBasis,
        penalties: { nutrient_low: 20000, nutrient_high: 20000, nutrient_target: 2000 }
      });

      const stepObjectiveBuild = buildObjectiveFunction({
        ingredientIds: ingredientVariableIds,
        ingredientCostVector: stepCostVector,
        deviationBuild: stepDevBuild,
        movementBuild: { variable_ids: [], variable_bounds_map: {}, variable_objective_map: {}, solver_rows: [] }
      });

      const stepVarBoundsMap = { ...stepBoundsMap, ...stepDevBuild.variable_bounds_map };

      const stepBasisConstraint = {
        type: "equality",
        coefficients: ingredientVariableIds.reduce((a, id) => { a[id] = 1; return a; }, {}),
        rhs: formulaBasis
      };

      const stepLpModel = buildJavascriptLpModel({
        allVariableIds: stepObjectiveBuild.all_variable_ids,
        objectiveCostVector: stepObjectiveBuild.objective_cost_vector,
        variableBoundsMap: stepVarBoundsMap,
        basisConstraint: stepBasisConstraint,
        solverReadyConstraints: stepDevBuild.solver_rows
      });

      const solve = await solveWithJavascriptLp(stepLpModel);

      const lpInfeasible = solve?.result?.feasible === false || solve?.result?.result === "Infeasible";
      const lpObjRaw = toNumber(solve?.result?.result, null);
      const hasObj = isFiniteNumber(lpObjRaw);
      const hasDecisionVals = !!solve?.result && ingredientVariableIds.some(id => isFiniteNumber(toNumber(solve.result[id], null)));
      const feasible = !!solve?.ok && !lpInfeasible && (hasObj || hasDecisionVals);

      if (!feasible) return { ok: false, reason: "INFEASIBLE", varied_inclusion: 0 };

      // Compute ingredient cost only (exclude deviation penalties)
      let ingredientCostRaw = 0;
      for (const id of ingredientVariableIds) {
        const val = toNumber(solve.result[id], 0);
        const cost = stepCostVector[id] ?? 0;
        ingredientCostRaw += val * cost;
      }
      const costPerKg = round4(ingredientCostRaw / formulaBasis);
      const costPerBag = round4(costPerKg * 50); // standard 50kg bag

      const ingredients = {};
      const ingredient_rows = [];
      for (const id of ingredientVariableIds) {
        const val = round4(toNumber(solve.result[id], 0));
        if (val > 0.001) {
          const meta = baseIngredients.find(x => x.id === id);
          ingredients[meta?.display_name || id] = val;
          ingredient_rows.push({ id, name: meta?.display_name || id, inclusion: val });
        }
      }

      let variedInclusion = null;
      if (varyType === "ingredient_price" || varyType === "ingredient_max") {
        const match = stepIngredients.find(ing =>
          normalizeKey(ing.id) === normalizeKey(varyKey || "") ||
          (ing.display_name && normalizeKey(ing.display_name) === normalizeKey(varyKey || ""))
        );
        if (match) variedInclusion = round4(toNumber(solve.result[match.id], 0));
      }

      return { ok: true, cost_per_kg: costPerKg, cost_per_bag: costPerBag, ingredients, ingredient_rows, varied_inclusion: variedInclusion };
    }

    // Generate parameter values
    const explicit = Array.isArray(vary.values)
      ? vary.values.map(v => toNumber(v, null)).filter(v => isFiniteNumber(v)).slice(0, 20)
      : [];
    const paramValues = explicit.length
      ? explicit.map(v => round4(v))
      : (() => {
          const out = [];
          for (let s = 0; s < numSteps; s++) {
            out.push(round4(fromVal + ((toVal - fromVal) * s) / Math.max(1, numSteps - 1)));
          }
          return out;
        })();

    const runs = [];
    for (let s = 0; s < paramValues.length; s++) {
      const paramValue = paramValues[s];

      // Clone ingredients and constraints with the varied parameter
      let stepIngredients = baseIngredients.map(ing => ({ ...ing }));
      let stepConstraints = baseConstraints.map(c => ({ ...c }));

      if (varyType === "nutrient_min") {
        stepConstraints = stepConstraints.map(c =>
          normalizeKey(c.key) === normalizeKey(varyKey || "") ? { ...c, min: paramValue } : c
        );
      } else if (varyType === "nutrient_max") {
        stepConstraints = stepConstraints.map(c =>
          normalizeKey(c.key) === normalizeKey(varyKey || "") ? { ...c, max: paramValue } : c
        );
      } else if (varyType === "ingredient_price") {
        stepIngredients = stepIngredients.map(ing =>
          normalizeKey(ing.id) === normalizeKey(varyKey || "") || (ing.display_name && normalizeKey(ing.display_name) === normalizeKey(varyKey || ""))
            ? { ...ing, cost: paramValue }
            : ing
        );
      } else if (varyType === "ingredient_max") {
        stepIngredients = stepIngredients.map(ing =>
          normalizeKey(ing.id) === normalizeKey(varyKey || "") || (ing.display_name && normalizeKey(ing.display_name) === normalizeKey(varyKey || ""))
            ? { ...ing, max: paramValue }
            : ing
        );
      }

      const result = await solveStep(stepIngredients, stepConstraints);
      runs.push({
        step: s + 1,
        param_value: paramValue,
        ...result
      });
    }

    return res.json({
      ok: true,
      vary,
      runs,
      meta: { engine: "AgroCore", module: "parametric_v1", timestamp_utc: new Date().toISOString() }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

const allocateService = require("../../../core/services/allocate.service.cjs");

router.post("/v1/optimize/allocate", async (req, res) => {
  try {
    const result = await allocateService.runAllocate(req.body || {});
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

router.post("/v1/optimize/allocate/parametric", async (req, res) => {
  try {
    const result = await allocateService.runBookParametric(req.body || {});
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

router.get("/v1/optimize/allocate/rhs/:millId", (req, res) => {
  try {
    const rhs = allocateService.resolveUsableTonnes({
      mill_id: req.params.millId,
      period_start: req.query.period_start || null,
      period_end: req.query.period_end || null
    });
    return res.json({ ok: true, ...rhs });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

router.post("/v1/optimize/allocate/farm-tons", (req, res) => {
  try {
    const result = allocateService.farmPlanTons(req.body || {});
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

export default router;

