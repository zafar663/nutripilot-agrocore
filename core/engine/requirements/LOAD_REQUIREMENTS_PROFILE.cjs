// C:\Users\Administrator\My Drive\NutriPilot\nutripilot-agrocore\core\engine\requirements\LOAD_REQUIREMENTS_PROFILE.cjs
"use strict";

/**
 * core/engine/requirements/LOAD_REQUIREMENTS_PROFILE.cjs
 *
 * v1.2.5 — HARD-FORCE broiler canonical Option-B from poultry/broiler/meat/*
 *
 * Key fixes:
 * 1) Supports BOTH broiler index schemas:
 *    A) New: idx.productions.meat.breeds[breed][phase]
 *    B) Existing: idx.breeds[breed][phase]   ✅ (your file)
 *
 * 2) Breed-specific MUST be used when provided.
 *    - Only falls back to generic if breed not found.
 *    - Adds meta.used_generic_fallback flag.
 *
 * 3) Always returns meta.requirements_mode / requirements_index_file / requirements_library_file
 *    pointing to poultry/broiler/meat/* paths (never poultry/broiler/v1 wrappers).
 *
 * 4) Library schema variants supported:
 *    A) { profiles: { reqKey: {targets...} } }
 *    B) { reqKey: {targets...}, ... } (flat)
 *    C) { library: { profiles: {...} } } (defensive)
 *
 * 5) BOM-safe JSON parsing + library-key -> registry-key mapping.
 */

const fs = require("fs");
const path = require("path");

// Fallback loader for non-broiler (or if broiler canonical fails)
const { loadRequirementsProfile } = require("../../db/requirements/_index/LOAD_REQUIREMENTS.cjs");

function isObj(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function readJsonBOMSafe(filePath) {
  let s = fs.readFileSync(filePath, "utf8");
  s = s.replace(/^\uFEFF/, "");
  return JSON.parse(s);
}

function extractNumericFlat(obj) {
  const out = {};
  if (!isObj(obj)) return out;

  for (const [k, v] of Object.entries(obj)) {
    let n = NaN;

    if (typeof v === "number") n = v;
    else if (typeof v === "string") {
      const m = v.trim().match(/-?\d+(\.\d+)?/);
      if (m) n = Number(m[0]);
    } else if (isObj(v)) {
      const candidate =
        v.value ??
        v.target ??
        v.recommended ??
        v.req ??
        v.minimum ??
        v.min ??
        v.maximum ??
        v.max;

      if (typeof candidate === "number") n = candidate;
      else if (typeof candidate === "string") {
        const m = candidate.trim().match(/-?\d+(\.\d+)?/);
        if (m) n = Number(m[0]);
      }
    }

    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function mapLibraryKeysToRegistry(reqRaw) {
  const raw = extractNumericFlat(reqRaw);

  const looksRegistry =
    Object.prototype.hasOwnProperty.call(raw, "me") ||
    Object.prototype.hasOwnProperty.call(raw, "cp") ||
    Object.prototype.hasOwnProperty.call(raw, "sid_lys");

  const looksLibrary =
    Object.prototype.hasOwnProperty.call(raw, "me_kcal_per_kg") ||
    Object.prototype.hasOwnProperty.call(raw, "cp_pct") ||
    Object.prototype.hasOwnProperty.call(raw, "sid_lys_pct");

  if (looksRegistry && !looksLibrary) {
    return { mapped: raw, applied: false, rawKeys: Object.keys(raw), mappedKeys: Object.keys(raw) };
  }

  const keyMap = {
    me_kcal_per_kg: "me",
    cp_pct: "cp",
    ca_pct: "ca",
    avp_pct: "avp",
    na_pct: "na",
    k_pct: "k",
    cl_pct: "cl",

    sid_lys_pct: "sid_lys",
    sid_met_pct: "sid_met",
    sid_metcys_pct: "sid_metcys",
    sid_thr_pct: "sid_thr",
    sid_trp_pct: "sid_trp",
    sid_arg_pct: "sid_arg",
  };

  const mapped = {};
  for (const [k, v] of Object.entries(raw)) {
    mapped[keyMap[k] || k] = v;
  }

  return { mapped, applied: looksLibrary, rawKeys: Object.keys(raw), mappedKeys: Object.keys(mapped) };
}

function norm(s) {
  return String(s || "").trim().toLowerCase().replace(/[‐-–—]/g, "-");
}

function normalizeBreedKey(breedIn) {
  // robust breed normalization (so you don’t accidentally fall back to generic)
  const b = norm(breedIn).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!b) return "generic";

  const alias = {
    ross: "ross_308",
    ross308: "ross_308",
    ross_308: "ross_308",
    ross_308_ap: "ross_308",
    cobb: "cobb_500",
    cobb500: "cobb_500",
    cobb_500: "cobb_500",
    hubbard_efficiency_plus: "hubbard",
    arbor_acres: "aa",
    arboracres: "aa",
    indian_river: "ir",
    indianriver: "ir",
  };

  return alias[b] || b;
}

function normalizePhaseKey(phaseIn) {
  const p = norm(phaseIn).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!p) return "starter";

  const alias = {
    pre_starter: "starter",
    prestarter: "starter",
    starter: "starter",
    grower: "grower",
    grower1: "grower",
    grower_1: "grower",
    finisher: "finisher",
    finish: "finisher",
  };

  return alias[p] || p;
}

function getBroilerMeatPaths() {
  // core/engine/requirements/*  -> core/db/requirements/*
  const dbReqBase = path.resolve(__dirname, "../../db/requirements");
  const base = path.join(dbReqBase, "poultry", "broiler", "meat");
  return {
    base,
    indexPath: path.join(base, "index.poultry_broiler_meat.v1.json"),
    libPath: path.join(base, "library.poultry_broiler_meat.v1.json"),
  };
}

function resolveBroilerMeatOptionB(selectors) {
  const { indexPath, libPath } = getBroilerMeatPaths();

  if (!fs.existsSync(indexPath) || !fs.existsSync(libPath)) {
    return {
      ok: false,
      error: "BROILER_OPTIONB_FILES_MISSING",
      message: "Broiler meat Option-B index/library files not found.",
      details: { indexPath, libPath },
    };
  }

  const idx = readJsonBOMSafe(indexPath);
  const libRaw = readJsonBOMSafe(libPath);

  // library schema variants
  const profilesWrapped =
    (isObj(libRaw) && isObj(libRaw.profiles) && libRaw.profiles) ||
    (isObj(libRaw) && isObj(libRaw.library) && isObj(libRaw.library.profiles) && libRaw.library.profiles) ||
    null;

  const profiles = profilesWrapped || (isObj(libRaw) ? libRaw : null);

  // normalize production/breed/phase
  const production = "meat";
  const breedWanted = normalizeBreedKey(selectors.breed || "generic");
  const phaseWanted = normalizePhaseKey(selectors.phase || "starter");

  // ---- Support BOTH index schemas ----
  // A) new schema: idx.productions.meat.breeds
  const breedsNodeA = idx && idx.productions && idx.productions[production] && idx.productions[production].breeds;
  // B) existing schema: idx.breeds   ✅ (your file)
  const breedsNodeB = idx && idx.breeds;

  const breedsNode = breedsNodeA || breedsNodeB;

  if (!breedsNode || !isObj(breedsNode)) {
    return {
      ok: false,
      error: "BROILER_INDEX_SCHEMA_INVALID",
      message: "Broiler meat index schema missing breeds mapping.",
      details: { indexPath, hasProductions: !!idx?.productions, hasBreeds: !!idx?.breeds },
    };
  }

  let used_generic_fallback = false;

  let reqKey =
    (breedsNode[breedWanted] && breedsNode[breedWanted][phaseWanted]) ||
    null;

  // If breed not found, fall back to generic (ONLY then)
  if (!reqKey && breedsNode.generic && breedsNode.generic[phaseWanted]) {
    used_generic_fallback = true;
    reqKey = breedsNode.generic[phaseWanted];
  }

  if (!reqKey) {
    return {
      ok: false,
      error: "REQUIREMENTS_PHASE_EMPTY",
      message: "No reqKey found for broiler meat selection (breed/phase).",
      details: { production, breedWanted, phaseWanted, indexPath, schema: breedsNodeA ? "A" : "B" },
      reqKey: null,
      selectors: selectors || null,
    };
  }

  const prof = (profiles && profiles[reqKey]) ? profiles[reqKey] : null;

  if (!prof) {
    return {
      ok: false,
      error: "REQUIREMENTS_PROFILE_MISSING",
      message: "ReqKey exists in index but profile not found in library.",
      details: { reqKey, libPath },
      reqKey,
    };
  }

  const reqRaw = prof.targets || prof.targets_override || {};

  const meta = {
    requirements_mode: "option_b",
    requirements_wrap_file: null,
    requirements_index_file: indexPath,
    requirements_library_file: libPath,
    production,
    production_inferred: !selectors.production && !selectors.production_type && !selectors.productionType,
    breed_wanted: breedWanted,
    phase_wanted: phaseWanted,
    used_generic_fallback,
    index_schema_used: breedsNodeA ? "A_productions" : "B_breeds",
  };

  return {
    ok: true,
    mode: "option_b",
    reqKey,
    requirements: reqRaw,
    profile: prof,
    wrapPath: null,
    indexPath,
    libPath,
    resolved: { reqKey, breed: used_generic_fallback ? "generic" : breedWanted, phase: phaseWanted, production },
    meta,
    source: { mode: "option_b", indexPath, libPath, wrapPath: null },
    sources: { mode: "option_b", indexPath, libPath, wrapPath: null },
  };
}

function resolveRequirements(selectors = {}) {
  const input = {
    species: selectors.species || "poultry",
    type: selectors.type || "broiler",
    breed: selectors.breed || "generic",
    phase: selectors.phase || "starter",
    region: selectors.region || "global",
    version: selectors.version || "v1",
    production:
      selectors.production ||
      selectors.production_type ||
      selectors.productionType ||
      "",
  };

  // ---- Canonical broiler meat resolver (forced) ----
  if (String(input.species).toLowerCase() === "poultry" && String(input.type).toLowerCase() === "broiler") {
    const rb = resolveBroilerMeatOptionB({ ...input, production: "meat" });

    if (rb && rb.ok === true) {
      const mapped = mapLibraryKeysToRegistry(rb.requirements || {});
      const meta = isObj(rb.meta) ? { ...rb.meta } : {};

      meta.requirements_targets_raw = extractNumericFlat(rb.requirements || {});
      meta.requirements_targets_raw_keys_used = mapped.rawKeys;
      meta.requirements_targets_mapped_keys_used = mapped.mappedKeys;
      meta.requirements_targets_mapping_applied = mapped.applied;

      // HARD-FORCE canonical paths into meta (never undefined)
      meta.requirements_mode = "option_b";
      meta.requirements_wrap_file = null;
      meta.requirements_index_file = rb.indexPath || meta.requirements_index_file || null;
      meta.requirements_library_file = rb.libPath || meta.requirements_library_file || null;

      return {
        ok: true,
        reqKey: rb.reqKey || null,
        requirements: mapped.mapped,
        profile: rb.profile || null,
        source: rb.source || rb.sources || null,
        sources: rb.sources || rb.source || null,
        resolved: rb.resolved || null,
        phase: input.phase,
        breed: input.breed,
        doc_meta: rb.doc_meta || null,
        meta,
        mode: "option_b",
        indexPath: rb.indexPath || null,
        libPath: rb.libPath || null,
        wrapPath: null,
      };
    }

    // Dev-friendly fall-through to DB loader (but broiler should be fixed via canonical files)
  }

  // ---- Fallback: DB loader for non-broiler ----
  const r = loadRequirementsProfile(input);

  if (!r || r.ok !== true) {
    return {
      ok: false,
      error: r?.error || "REQUIREMENTS_LOAD_FAILED",
      message: r?.message || "Requirements could not be loaded.",
      details: r?.details || null,
      key: r?.key || null,
      reqKey: r?.reqKey || null,
      reqFilePath: r?.reqFilePath || null,
      selectors: input,
      source: r?.source || r?.sources || r?.meta?.source || null,
      sources: r?.sources || r?.source || r?.meta?.source || null,
      resolved: r?.resolved || r?.meta?.resolved || null,
      doc_meta: r?.doc_meta || r?.meta?.doc_meta || null,
      profile: r?.profile || r?.meta?.profile || null,
    };
  }

  const srcObj =
    (r.sources && typeof r.sources === "object" && r.sources) ||
    (r.source && typeof r.source === "object" && r.source) ||
    (r.meta && typeof r.meta.source === "object" && r.meta.source) ||
    {};

  const srcRaw =
    (typeof r.sources === "string" && r.sources) ||
    (typeof r.source === "string" && r.source) ||
    (typeof r.meta?.source === "string" && r.meta.source) ||
    null;

  const mergedSource = {
    ...srcObj,
    ...(srcRaw ? { source_raw: srcRaw } : {}),
    ...(typeof r.wrapPath === "string" ? { wrapPath: r.wrapPath } : {}),
    ...(typeof r.indexPath === "string" ? { indexPath: r.indexPath } : {}),
    ...(typeof r.libPath === "string" ? { libPath: r.libPath } : {}),
    ...(typeof r.libraryPath === "string" ? { libPath: r.libraryPath } : {}),
    ...(typeof r.mode === "string" ? { mode: r.mode } : {}),
  };

  const reqRaw = r.requirements || r.targets || (r.profile && r.profile.targets) || {};
  const mapped = mapLibraryKeysToRegistry(reqRaw);

  const meta = isObj(r.meta) ? { ...r.meta } : {};
  meta.requirements_targets_raw = extractNumericFlat(reqRaw);
  meta.requirements_targets_raw_keys_used = mapped.rawKeys;
  meta.requirements_targets_mapped_keys_used = mapped.mappedKeys;
  meta.requirements_targets_mapping_applied = mapped.applied;

  return {
    ok: true,
    reqKey: r.reqKey || r.key || null,
    requirements: mapped.mapped,
    profile: r.profile || null,
    source: mergedSource,
    sources: mergedSource,
    resolved: r.resolved || r.meta?.resolved || null,
    phase: r.phase || input.phase,
    breed: r.breed || input.breed,
    doc_meta: r.doc_meta || r.meta?.doc_meta || null,
    meta,
  };
}

module.exports = { resolveRequirements };