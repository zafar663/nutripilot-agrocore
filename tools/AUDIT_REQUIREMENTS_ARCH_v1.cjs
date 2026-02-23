"use strict";

const fs = require("fs");
const path = require("path");

function readJson(p) {
  const s = fs.readFileSync(p, "utf-8").replace(/^\uFEFF/, "");
  return JSON.parse(s);
}
function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}
function safeLower(s) { return String(s || "").trim().toLowerCase(); }
function normalizeToken(s) {
  return safeLower(s).replace(/\s+/g, "_").replace(/[^a-z0-9_]+/g, "_");
}

function extractNumericTargets(obj) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const num = Number(v);
    if (Number.isFinite(num)) out[k] = num;
  }
  return out;
}

function resolveTargetsFromLibrary(libObj, phaseKey) {
  if (!libObj || typeof libObj !== "object") return {};

  // preferred schema
  if (libObj.profiles && typeof libObj.profiles === "object") {
    const generic = libObj.profiles.generic || {};
    const phaseObj = generic.targets_by_phase && generic.targets_by_phase[phaseKey]
      ? generic.targets_by_phase[phaseKey]
      : null;
    const req = extractNumericTargets(phaseObj || {});
    if (Object.keys(req).length) return req;
  }

  // alternate schemas
  if (libObj.targets_by_phase && typeof libObj.targets_by_phase === "object") {
    const req = extractNumericTargets(libObj.targets_by_phase[phaseKey] || {});
    if (Object.keys(req).length) return req;
  }
  if (libObj.targets) {
    const req = extractNumericTargets(libObj.targets);
    if (Object.keys(req).length) return req;
  }
  if (libObj.nutrient_targets) {
    const req = extractNumericTargets(libObj.nutrient_targets);
    if (Object.keys(req).length) return req;
  }
  return {};
}

function listJson(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith(".json"));
}

function auditType(baseDir, type) {
  const t = normalizeToken(type);
  const wrapPath = path.join(baseDir, "poultry", t, "v1", `requirements.index.poultry.${t}.v1.json`);

  const out = {
    type: t,
    wrapper: { path: wrapPath, exists: exists(wrapPath), hasProductions: false, productions: [] },
    productions: {},
    phaseFallback: {},
    verdict: []
  };

  if (!out.wrapper.exists) {
    out.verdict.push("MISSING_WRAPPER");
    return out;
  }

  let wrap = null;
  try { wrap = readJson(wrapPath); } catch { wrap = null; }

  out.wrapper.hasProductions = !!(wrap && wrap.productions && typeof wrap.productions === "object");
  const prods = out.wrapper.hasProductions ? Object.keys(wrap.productions) : [];

  out.wrapper.productions = prods;

  // check each production pointer
  for (const prod of prods) {
    const p = normalizeToken(prod);
    const idxRel = wrap.productions[prod]?.index_file;
    const libRel = wrap.productions[prod]?.library_file;

    const idxPath = idxRel ? path.resolve(path.dirname(wrapPath), idxRel) : null;
    const libPath = libRel ? path.resolve(path.dirname(wrapPath), libRel) : null;

    const prodInfo = {
      prod: p,
      indexPath: idxPath,
      libPath: libPath,
      indexExists: !!(idxPath && exists(idxPath)),
      libExists: !!(libPath && exists(libPath)),
      libHasStarterTargets: false,
      libHasGrowerTargets: false,
      libHasFinisherTargets: false
    };

    let libObj = null;
    if (prodInfo.libExists) {
      try { libObj = readJson(libPath); } catch { libObj = null; }
    }

    // sanity-check 3 common phases. (You can expand later.)
    if (libObj) {
      prodInfo.libHasStarterTargets = Object.keys(resolveTargetsFromLibrary(libObj, "starter")).length > 0;
      prodInfo.libHasGrowerTargets = Object.keys(resolveTargetsFromLibrary(libObj, "grower")).length > 0;
      prodInfo.libHasFinisherTargets = Object.keys(resolveTargetsFromLibrary(libObj, "finisher")).length > 0;
    }

    out.productions[p] = prodInfo;
  }

  // phase fallback directory check (only meaningful for broiler right now)
  // core/db/requirements/poultry/<type>/v1/<region>/*.json
  const v1Dir = path.join(baseDir, "poultry", t, "v1");
  if (exists(v1Dir)) {
    const regions = fs.readdirSync(v1Dir).filter(n => fs.statSync(path.join(v1Dir, n)).isDirectory());
    for (const r of regions) {
      // skip "v1" folder itself and wrapper json area: we only care about region dirs like "us"
      if (r.toLowerCase() === "v1") continue;
      const regionDir = path.join(v1Dir, r);
      const files = listJson(regionDir);
      out.phaseFallback[r] = files;
    }
  }

  // verdict logic
  if (!out.wrapper.hasProductions) out.verdict.push("WRAPPER_NO_PRODUCTIONS");
  if (out.wrapper.hasProductions) {
    const prodKeys = Object.keys(out.productions);
    if (!prodKeys.length) out.verdict.push("NO_PRODUCTIONS_DEFINED");
    for (const pk of prodKeys) {
      const pi = out.productions[pk];
      if (!pi.indexExists) out.verdict.push(`PROD_${pk}_MISSING_INDEX`);
      if (!pi.libExists) out.verdict.push(`PROD_${pk}_MISSING_LIBRARY`);
      if (pi.libExists && !pi.libHasStarterTargets && !pi.libHasGrowerTargets && !pi.libHasFinisherTargets) {
        out.verdict.push(`PROD_${pk}_LIB_NO_TARGETS`);
      }
    }
  }

  return out;
}

function main() {
  const baseDir = path.join(__dirname, "..", "core", "db", "requirements");
  const poultryDir = path.join(baseDir, "poultry");
  const types = exists(poultryDir)
    ? fs.readdirSync(poultryDir).filter(n => fs.statSync(path.join(poultryDir, n)).isDirectory())
    : [];

  const report = types.map(t => auditType(baseDir, t));
  console.log(JSON.stringify({ baseDir, types, report }, null, 2));
}

main();