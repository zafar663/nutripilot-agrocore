/*
  AgroCore Requirements Loader
  File: core/db/requirements/_index/LOAD_REQUIREMENTS.cjs

  Purpose:
  Resolve species/type/breed/region/version/phase
  → manifest key
  → absolute JSON file
  → parsed requirements object

  Compatible with CommonJS (Node 20.x)
*/

"use strict";

const fs = require("fs");
const path = require("path");

// requirements root folder
const REQUIREMENTS_ROOT = path.resolve(__dirname, "..");

// manifest file path
const MANIFEST_FILE = path.join(__dirname, "requirements.manifest.v1.json");

// in-memory caches
let MANIFEST_CACHE = null;
const JSON_CACHE = new Map();

function stripBOM(s) {
  // Remove UTF-8 BOM if present (fixes: Unexpected token '﻿' ...)
  if (typeof s !== "string") return s;
  return s.replace(/^\uFEFF/, "");
}

/* ============================================================
   Load Manifest (once)
   ============================================================ */
function loadManifest() {
  if (MANIFEST_CACHE) return MANIFEST_CACHE;

  if (!fs.existsSync(MANIFEST_FILE)) {
    const err = new Error(`Requirements manifest missing at: ${MANIFEST_FILE}`);
    err.code = "REQ_MANIFEST_MISSING";
    throw err;
  }

  const raw = stripBOM(fs.readFileSync(MANIFEST_FILE, "utf8"));
  const json = JSON.parse(raw);

  if (!json.items || typeof json.items !== "object") {
    const err = new Error("Invalid requirements manifest structure");
    err.code = "REQ_MANIFEST_INVALID";
    throw err;
  }

  MANIFEST_CACHE = json;
  return MANIFEST_CACHE;
}

/* ============================================================
   Key Builder
   Format:
   species__type__breed__region__version__phase
   ============================================================ */
function buildReqKey({ species, type, breed = "generic", region = "global", version = "v1", phase }) {
  return [
    String(species || "").toLowerCase().trim(),
    String(type || "").toLowerCase().trim(),
    String(breed || "generic").toLowerCase().trim(),
    String(region || "global").toLowerCase().trim(),
    String(version || "v1").toLowerCase().trim(),
    String(phase || "").toLowerCase().trim(),
  ].join("__");
}

/* ============================================================
   Fallback Logic (Specific → Generic)
   ============================================================ */
function buildFallbackKeys(selectors = {}) {
  const base = {
    species: selectors.species,
    type: selectors.type,
    phase: selectors.phase,
    version: selectors.version || "v1",
  };

  const keys = [];

  // Full specific
  keys.push(
    buildReqKey({
      ...base,
      breed: selectors.breed || "generic",
      region: selectors.region || "global",
    })
  );

  // Generic breed
  keys.push(
    buildReqKey({
      ...base,
      breed: "generic",
      region: selectors.region || "global",
    })
  );

  // Global region
  keys.push(
    buildReqKey({
      ...base,
      breed: selectors.breed || "generic",
      region: "global",
    })
  );

  // Generic breed + global
  keys.push(
    buildReqKey({
      ...base,
      breed: "generic",
      region: "global",
    })
  );

  return Array.from(new Set(keys));
}

/* ============================================================
   Resolve Key → Absolute JSON Path
   ============================================================ */
function resolvePathFromManifest(reqKey) {
  const manifest = loadManifest();
  const relativePath = manifest.items[reqKey];
  if (!relativePath) return null;

  const absolutePath = path.resolve(REQUIREMENTS_ROOT, relativePath);

  // Security check
  if (!absolutePath.startsWith(REQUIREMENTS_ROOT)) {
    const err = new Error(`Unsafe path detected for key ${reqKey}`);
    err.code = "REQ_PATH_UNSAFE";
    throw err;
  }

  return absolutePath;
}

/* ============================================================
   Load JSON with Cache
   ============================================================ */
function loadJsonFile(absPath) {
  if (JSON_CACHE.has(absPath)) return JSON_CACHE.get(absPath);

  if (!fs.existsSync(absPath)) {
    const err = new Error(`Requirements JSON not found at ${absPath}`);
    err.code = "REQ_FILE_MISSING";
    throw err;
  }

  const raw = stripBOM(fs.readFileSync(absPath, "utf8"));
  const json = JSON.parse(raw);

  JSON_CACHE.set(absPath, json);
  return json;
}

/* ============================================================
   MAIN FUNCTION (low-level)
   ============================================================ */
function loadRequirements(selectors = {}) {
  const keysToTry = buildFallbackKeys(selectors);

  for (const key of keysToTry) {
    const absPath = resolvePathFromManifest(key);
    if (!absPath) continue;

    const requirements = loadJsonFile(absPath);

    return {
      ok: true,
      reqKeyUsed: key,
      reqPath: path.relative(process.cwd(), absPath),
      requirements,
      meta: { tried: keysToTry },
    };
  }

  const err = new Error(`No matching requirements found. Tried: ${keysToTry.join(", ")}`);
  err.code = "REQ_NOT_FOUND";
  err.meta = { tried: keysToTry };
  throw err;
}

/* ============================================================
   MAIN FUNCTION (analyzer-compatible)
   - analyzeFormula.cjs expects: { ok, reqKey, reqFilePath, requirements, doc_meta }
   ============================================================ */
function loadRequirementsProfile(selectors = {}) {
  try {
    const r = loadRequirements(selectors);

    const doc_meta = r?.requirements?._LOCK?.meta || null;

    return {
      ok: true,
      reqKey: r.reqKeyUsed,
      reqFilePath: r.reqPath,
      requirements: r.requirements,
      doc_meta,
    };
  } catch (e) {
    return {
      ok: false,
      error: e.code || "REQ_ERROR",
      message: e.message || "Requirements load failed",
      meta: e.meta || null,
    };
  }
}

/* ============================================================
   EXPORTS
   ============================================================ */
module.exports = {
  loadRequirements,          // low-level
  loadRequirementsProfile,   // ✅ what analyzeFormula expects
  buildReqKey,
  buildFallbackKeys,
  default: loadRequirementsProfile,
};
