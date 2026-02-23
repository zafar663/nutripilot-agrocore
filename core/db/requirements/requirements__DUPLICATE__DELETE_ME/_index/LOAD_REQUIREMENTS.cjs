// core/db/requirements/_index/LOAD_REQUIREMENTS.cjs
"use strict";

const fs = require("fs");
const path = require("path");

function readJsonIfExists(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
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

function loadIndex(baseDir) {
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

/**
 * Requirement file format:
 * {
 *  "_meta": {...},
 *  "phases": [
 *    { "phase":"starter","age_days":[0,10], "me":..., "cp":..., ... }
 *  ]
 * }
 */
function pickPhase(reqDoc, phase) {
  const phases = Array.isArray(reqDoc?.phases) ? reqDoc.phases : [];
  if (!phases.length) return null;

  const wanted = normalizeToken(phase || "");
  if (!wanted) return phases[0];

  const hit = phases.find(p => normalizeToken(p?.phase) === wanted);
  return hit || phases[0];
}

function toRequirementsMap(phaseObj) {
  const out = {};
  if (!phaseObj || typeof phaseObj !== "object") return out;

  for (const [k, v] of Object.entries(phaseObj)) {
    if (k === "phase" || k === "age_days" || k === "_meta") continue;
    const num = Number(v);
    if (Number.isFinite(num)) out[k] = num;
  }
  return out;
}

function loadRequirementsProfile(input = {}) {
  const baseDir = path.join(__dirname, ".."); // core/db/requirements

  const { idx, indexPath } = loadIndex(baseDir);
  const { aliases, aliasPath } = loadAliases(baseDir);

  if (!idx || !Array.isArray(idx.entries)) {
    return {
      ok: false,
      error: "REQUIREMENTS_INDEX_MISSING",
      message: `Index missing or invalid: ${indexPath}`,
      indexPath,
      aliasPath
    };
  }

  const species = applyAlias(aliases?.species, input.species || "poultry");
  const type = applyAlias(aliases?.type, input.type || "broiler");
  const breed = applyAlias(aliases?.breed, input.breed || "ross_308");
  const region = applyAlias(aliases?.region, input.region || "global");
  const version = applyAlias(aliases?.version, input.version || "v2025");
  const phase = input.phase || "starter";

  const key = buildKey({ species, type, breed, region, version });

  const match = idx.entries.find(e => e && e.key === key);
  if (!match || !match.path) {
    return {
      ok: false,
      error: "REQUIREMENTS_PROFILE_NOT_FOUND",
      message: `No requirements profile in index for key: ${key}`,
      key,
      indexPath
    };
  }

  const reqFilePath = path.join(baseDir, match.path);
  const doc = readJsonIfExists(reqFilePath);

  if (!doc) {
    return {
      ok: false,
      error: "REQUIREMENTS_FILE_UNREADABLE",
      message: `Requirements file not readable: ${reqFilePath}`,
      key,
      reqFilePath
    };
  }

  const phaseObj = pickPhase(doc, phase);
  if (!phaseObj) {
    return {
      ok: false,
      error: "REQUIREMENTS_EMPTY",
      message: `Requirements file has no phases[]: ${reqFilePath}`,
      key,
      reqFilePath
    };
  }

  const requirements = toRequirementsMap(phaseObj);
  if (!Object.keys(requirements).length) {
    return {
      ok: false,
      error: "REQUIREMENTS_PHASE_EMPTY",
      message: `Phase found but no numeric nutrient keys present: ${reqFilePath}`,
      key,
      reqFilePath,
      phase: phaseObj?.phase || phase
    };
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

module.exports = { loadRequirementsProfile };
