// core/db/requirements/_index/LOAD_REQUIREMENTS.cjs
"use strict";

const fs = require("fs");
const path = require("path");

function readJson(p) {
  const s = fs.readFileSync(p, "utf-8").replace(/^\uFEFF/, "");
  return JSON.parse(s);
}
function readJsonIfExists(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return readJson(p);
  } catch (_) {
    return null;
  }
}
function safeLower(s) {
  return String(s || "").trim().toLowerCase();
}
function normalizeToken(s) {
  return safeLower(s).replace(/\s+/g, "_").replace(/[^a-z0-9_]+/g, "_");
}

function loadLegacyIndex(baseDir) {
  const indexPath = path.join(baseDir, "_index", "requirements.index.v1.json");
  const idx = readJsonIfExists(indexPath);
  return { idx, indexPath };
}
function loadAliases(baseDir) {
  const aliasPath = path.join(baseDir, "_index", "requirements.aliases.v1.json");
  const aliases = readJsonIfExists(aliasPath) || {};
  return { aliases, aliasPath };
}
function applyAlias(mapObj, rawValue) {
  const v0 = String(rawValue ?? "").trim();
  if (!v0) return "";
  const key = safeLower(v0);
  if (mapObj && Object.prototype.hasOwnProperty.call(mapObj, key)) return mapObj[key];

  const norm = normalizeToken(v0);
  if (mapObj && Object.prototype.hasOwnProperty.call(mapObj, norm)) return mapObj[norm];
  return norm;
}
function buildKey({ species, type, breed, region, version }) {
  return `${normalizeToken(species)}/${normalizeToken(type)}/${normalizeToken(breed)}/${normalizeToken(region)}/${normalizeToken(version)}`;
}

// Legacy vendor format: phases[]
function pickPhaseLegacy(reqDoc, phase) {
  const phases = Array.isArray(reqDoc?.phases) ? reqDoc.phases : [];
  if (!phases.length) return null;
  const wanted = normalizeToken(phase || "");
  if (!wanted) return phases[0];
  const hit = phases.find(p => normalizeToken(p?.phase) === wanted);
  return hit || phases[0];
}
function toRequirementsMapLegacy(phaseObj) {
  const out = {};
  if (!phaseObj || typeof phaseObj !== "object") return out;
  for (const [k, v] of Object.entries(phaseObj)) {
    if (k === "phase" || k === "age_days" || k === "_meta") continue;
    const num = Number(v);
    if (Number.isFinite(num)) out[k] = num;
  }
  return out;
}

// -------- Option-B (index+library) --------
function resolveOptionB({ baseDir, type, production, breed, phase }) {
  const t = normalizeToken(type);
  const prod = normalizeToken(production);
  const b = normalizeToken(breed || "generic");
  const ph = normalizeToken(phase || "starter");

  // Wrapper: core/db/requirements/poultry/<type>/v1/requirements.index.poultry.<type>.v1.json
  const wrapPath = path.join(baseDir, "poultry", t, "v1", `requirements.index.poultry.${t}.v1.json`);
  const wrap = readJsonIfExists(wrapPath);

  let indexPath = null;
  let libPath = null;

  if (wrap?.productions?.[prod]) {
    indexPath = path.resolve(path.dirname(wrapPath), wrap.productions[prod].index_file);
    libPath   = path.resolve(path.dirname(wrapPath), wrap.productions[prod].library_file);
  } else {
    // Direct fallback: core/db/requirements/poultry/<type>/<production>/
    const directDir = path.join(baseDir, "poultry", t, prod);
    const di = path.join(directDir, `index.poultry_${t}_${prod}.v1.json`);
    const dl = path.join(directDir, `library.poultry_${t}_${prod}.v1.json`);
    if (fs.existsSync(di) && fs.existsSync(dl)) {
      indexPath = di;
      libPath = dl;
    }
  }

  if (!indexPath || !libPath || !fs.existsSync(indexPath) || !fs.existsSync(libPath)) {
    return {
      ok: false,
      error: "REQUIREMENTS_OPTIONB_NOT_FOUND",
      message: `Option-B requirements not found for poultry/${t}/${prod}. Missing index/library.`,
      details: { wrapPath, indexPath, libPath }
    };
  }

  const indexObj = readJsonIfExists(indexPath);
  const libObj   = readJsonIfExists(libPath);

  if (!indexObj || !libObj) {
    return {
      ok: false,
      error: "REQUIREMENTS_OPTIONB_FILES_UNREADABLE",
      message: "Option-B index/library unreadable",
      details: { indexPath, libPath }
    };
  }

  // Resolve reqKey from index map
  const breedsMap = indexObj?.map || {};
  const breedKey = breedsMap[b] ? b : (breedsMap["generic"] ? "generic" : Object.keys(breedsMap)[0]);
  const phasesMap = breedKey ? breedsMap[breedKey] : null;

  if (!phasesMap) {
    return {
      ok: false,
      error: "REQUIREMENTS_OPTIONB_INDEX_INVALID",
      message: "Option-B index missing map[breed][phase]",
      details: { indexPath, breedKey }
    };
  }

  const reqKey = phasesMap[ph] || phasesMap["starter"] || Object.values(phasesMap)[0];
  if (!reqKey) {
    return {
      ok: false,
      error: "REQUIREMENTS_OPTIONB_REQKEY_MISSING",
      message: "Option-B index could not resolve reqKey",
      details: { indexPath, breedKey, phase: ph }
    };
  }

  // Merge generic targets_by_phase + overrides (numeric only)
  const profiles = libObj?.profiles || {};
  const generic = profiles["generic"] || {};
  const prof = profiles[breedKey] || {};

  const genericPhase = (generic?.targets_by_phase && generic.targets_by_phase[ph]) ? generic.targets_by_phase[ph] : null;

  const merged = Object.assign({},
    genericPhase || {},
    generic?.targets_override || {},
    prof?.targets_override || {}
  );

  const requirements = {};
  for (const [k, v] of Object.entries(merged || {})) {
    const num = Number(v);
    if (Number.isFinite(num)) requirements[k] = num;
  }

  if (!Object.keys(requirements).length) {
    return {
      ok: false,
      error: "REQUIREMENTS_PHASE_EMPTY",
      message: "Option-B profile resolved but has no numeric targets yet (fill library generic targets_by_phase).",
      reqKey,
      details: { libPath, breedKey, phase: ph }
    };
  }

  return {
    ok: true,
    reqKey,
    requirements,
    breed: breedKey,
    phase: ph,
    source: { mode: "option_b", wrapPath, indexPath, libPath },
    doc_meta: libObj?._LOCK || libObj?._meta || null
  };
}

function loadRequirementsProfile(input = {}) {
  const baseDir = path.join(__dirname, ".."); // core/db/requirements
  const { idx, indexPath } = loadLegacyIndex(baseDir);
  const { aliases, aliasPath } = loadAliases(baseDir);

  const species = applyAlias(aliases?.species, input.species || "poultry");
  const type = applyAlias(aliases?.type, input.type || "broiler");
  const breed = applyAlias(aliases?.breed, input.breed || "ross_308");
  const region = applyAlias(aliases?.region, input.region || "global");
  const version = applyAlias(aliases?.version, input.version || "v2025");
  const phase = input.phase || "starter";
  const production = input.production || "";

  // A) Legacy vendor index
  if (idx && Array.isArray(idx.entries)) {
    const key = buildKey({ species, type, breed, region, version });
    const match = idx.entries.find(e => e && e.key === key);
    if (match?.path) {
      const reqFilePath = path.join(baseDir, match.path);
      const doc = readJsonIfExists(reqFilePath);
      if (!doc) {
        return { ok:false, error:"REQUIREMENTS_FILE_UNREADABLE", message:`Requirements file not readable: ${reqFilePath}`, key, reqFilePath };
      }
      const phaseObj = pickPhaseLegacy(doc, phase);
      if (!phaseObj) {
        return { ok:false, error:"REQUIREMENTS_EMPTY", message:`Requirements file has no phases[]: ${reqFilePath}`, key, reqFilePath };
      }
      const requirements = toRequirementsMapLegacy(phaseObj);
      if (!Object.keys(requirements).length) {
        return { ok:false, error:"REQUIREMENTS_PHASE_EMPTY", message:`Phase found but no numeric keys: ${reqFilePath}`, key, reqFilePath, phase: phaseObj?.phase || phase };
      }
      return {
        ok: true,
        reqKey: key,
        reqFilePath,
        species, type, breed, region, version,
        phase: phaseObj?.phase || phase,
        requirements,
        doc_meta: doc?._meta || null
      };
    }
  }

  // B) Option-B for poultry + v1
  if (normalizeToken(species) === "poultry" && normalizeToken(version) === "v1") {
    if (!String(production || "").trim()) {
      return {
        ok:false,
        error:"REQUIREMENTS_NEEDS_PRODUCTION",
        message:"Option-B V1 requires input.production (meat/layer/breeder).",
        meta:{ species, type, breed, region, version, phase }
      };
    }
    const ob = resolveOptionB({ baseDir, type, production, breed, phase });
    if (ob.ok) {
      return {
        ok: true,
        reqKey: ob.reqKey,
        reqFilePath: ob.source?.indexPath || null,
        species, type: normalizeToken(type), breed: ob.breed, region, version,
        phase: ob.phase,
        requirements: ob.requirements,
        doc_meta: ob.doc_meta || null,
        source: ob.source || null
      };
    }
    return Object.assign({ species, type: normalizeToken(type), breed, region, version, phase, production }, ob);
  }

  return {
    ok:false,
    error:"REQUIREMENTS_PROFILE_NOT_FOUND",
    message:"No requirements profile found in legacy index, and Option-B not applicable.",
    meta:{ species, type, breed, region, version, phase, production },
    indexPath,
    aliasPath
  };
}

module.exports = { loadRequirementsProfile };

