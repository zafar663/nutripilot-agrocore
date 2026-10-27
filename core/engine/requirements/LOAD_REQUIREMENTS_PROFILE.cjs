"use strict";

/**
 * core/engine/requirements/LOAD_REQUIREMENTS_PROFILE.cjs
 *
 * v1.2.6 Ã¢â‚¬â€ Minimal change: explicit generic-fallback warning fields
 *
 * Key fixes:
 * 1) Supports BOTH broiler index schemas:
 *    A) New: idx.productions.meat.breeds[breed][phase]
 *    B) Existing: idx.breeds[breed][phase]
 *
 * 2) Breed-specific MUST be used when provided.
 *    - Only falls back to generic if breed not found.
 *    - Adds meta.used_generic_fallback flag.
 *    - Adds meta.requirements_fallback_used + meta.requirements_warning
 *      so user is clearly told generic is NOT breeder-company recommendations.
 *
 * 3) Always returns meta.requirements_mode / requirements_index_file / requirements_library_file
 *    for explicit Option-B resolvers.
 *
 * 4) Library schema variants supported:
 *    A) { profiles: { reqKey: {targets...} } }
 *    B) { reqKey: {targets...}, ... } (flat)
 *    C) { library: { profiles: {...} } } (defensive)
 *
 * 5) BOM-safe JSON parsing + library-key -> registry-key mapping.
 *
 * 6) Added explicit poultry/layer Option-B resolver with support for idx.breed_aliases
 *    so aliases like lohmann_lsl -> lohmann_lsl_classic resolve correctly.
 */

const fs = require("fs");
const path = require("path");

// Fallback loader for non-explicit paths
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

function isNonEmptyObj(x) {
  return isObj(x) && Object.keys(x).length > 0;
}

function resolveInheritedTargets(profiles, prof, depth = 0, seen = new Set()) {
  if (!isObj(prof) || depth > 8) return {};
  const id = prof.reqKey || prof._id || null;
  if (id) {
    if (seen.has(id)) return {};
    seen.add(id);
  }

  let base = {};
  const inherits = prof.inherits || prof.inherit || prof.parent || null;
  const inheritList = Array.isArray(inherits) ? inherits : (inherits ? [inherits] : []);

  for (const parentKey of inheritList) {
    if (parentKey && profiles && profiles[parentKey]) {
      base = {
        ...base,
        ...resolveInheritedTargets(profiles, profiles[parentKey], depth + 1, seen),
      };
      const parentTargets = profiles[parentKey]?.targets;
      const parentOverrides = profiles[parentKey]?.targets_override;
      if (isNonEmptyObj(parentTargets)) base = { ...base, ...parentTargets };
      if (isNonEmptyObj(parentOverrides)) base = { ...base, ...parentOverrides };
    }
  }

  if (isNonEmptyObj(prof.targets)) base = { ...base, ...prof.targets };
  if (isNonEmptyObj(prof.targets_override)) base = { ...base, ...prof.targets_override };

  return base;
}

function pickTargets(prof, profiles = null) {
  const t = (prof && isObj(prof.targets)) ? prof.targets : null;
  const o = (prof && isObj(prof.targets_override)) ? prof.targets_override : null;

  const tCount = t ? Object.keys(t).length : 0;
  const oCount = o ? Object.keys(o).length : 0;

  if (tCount > 0 && oCount > 0) return { ...t, ...o };
  if (tCount > 0) return t;
  if (oCount > 0) return o;

  return resolveInheritedTargets(profiles, prof);
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
    return {
      mapped: raw,
      applied: false,
      rawKeys: Object.keys(raw),
      mappedKeys: Object.keys(raw),
    };
  }

  const keyMap = {
    me_kcal_per_kg: "me",
    cp_pct: "cp",
    ca_pct: "ca",
    avp_pct: "avp",
    na_pct: "na",
    k_pct: "k",
    cl_pct: "cl",
    mg_pct: "mg",

    sid_lys_pct: "sid_lys",
    sid_met_pct: "sid_met",
    sid_metcys_pct: "sid_metcys",
    sid_thr_pct: "sid_thr",
    sid_trp_pct: "sid_trp",
    sid_arg_pct: "sid_arg",
    sid_his_pct: "sid_his",
    sid_phetyr_pct: "sid_phetyr",
    linoleic_pct: "linoleic",
    linoleic_acid_pct: "linoleic",
    linoleic_acid: "linoleic",
    linolenic_pct: "linolenic",
    linolenic_acid_pct: "linolenic",
  };

  const swineKeyMap = {
    ne_kcal_per_kg: "ne",
    calcium_pct: "ca",
    sodium_pct: "na",
    chloride_pct: "cl",
    trace_zn_ppm: "zn",
    trace_fe_ppm: "fe",
    trace_mn_ppm: "mn",
    trace_cu_ppm: "cu",
    trace_iodine_ppm: "i",
    trace_se_ppm: "se",
    vit_a_iu_per_kg: "vit_a",
    vit_d3_iu_per_kg: "vit_d3",
    vit_e_iu_per_kg: "vit_e",
    vit_k_mg_per_kg: "vit_k",
    niacin_mg_per_kg: "niacin",
    riboflavin_mg_per_kg: "vit_b2",
    pantothenic_acid_mg_per_kg: "pantothenic_acid",
    vit_b12_mcg_per_kg: "vit_b12",
    choline_mg_per_kg: "choline",
    folic_acid_mcg_per_kg: "folic_acid",
    biotin_mcg_per_kg: "biotin",
    thiamine_mg_per_kg: "vit_b1",
    pyridoxine_mg_per_kg: "vit_b6",
  };
  const mergedKeyMap = Object.assign({}, keyMap, swineKeyMap);
  const mapped = {};
  for (const [k, v] of Object.entries(raw)) {
    mapped[mergedKeyMap[k] || k] = v;
  }
  // NP_SWINE_RATIO_RESOLVE_V1
  if (mapped.ne == null && typeof mapped.ne_kcal_per_kg === "number") mapped.ne = mapped.ne_kcal_per_kg;
  const neVal = mapped.ne;
  const meVal = mapped.me;
  if (mapped.sid_lys == null && typeof mapped.sid_lys_ne_ratio === "number" && typeof neVal === "number" && neVal > 0) {
    mapped.sid_lys = Math.round(mapped.sid_lys_ne_ratio * neVal / 10000 * 10000) / 10000;
  }
  if (mapped.sid_lys == null && typeof mapped.sid_lys_me_ratio === "number" && typeof meVal === "number" && meVal > 0) {
    mapped.sid_lys = Math.round(mapped.sid_lys_me_ratio * meVal / 10000 * 10000) / 10000;
  }
  // Gestation/Lactation: sid_lys stored as g/day - convert to % using reference feed intake
  if (mapped.sid_lys == null && typeof mapped.sid_lys_min_g_day === "number" && mapped.sid_lys_min_g_day > 0) {
    const refIntakeKgDay = typeof mapped.sid_lys_ref_intake_kg_day === "number" ? mapped.sid_lys_ref_intake_kg_day : 2.2;
    mapped.sid_lys = Math.round(mapped.sid_lys_min_g_day / (refIntakeKgDay * 10) * 10000) / 10000;
  }
  // Lactation: sid_lys stored in profile.feed_intake.daily_requirements
  if (mapped.sid_lys == null) {
    const dailyReq = mapped._profile_daily_requirements || null;
    const lysGDay = dailyReq && dailyReq.sid_lys_g_day && typeof dailyReq.sid_lys_g_day.single_diet_herd === "number"
      ? dailyReq.sid_lys_g_day.single_diet_herd
      : null;
    const intakeKgDay = 6.0; // lactation herd reference feed intake
    if (typeof lysGDay === "number" && lysGDay > 0) {
      mapped.sid_lys = Math.round(lysGDay / (intakeKgDay * 10) * 10000) / 10000;
    }
  }
  if (typeof mapped.sid_lys === "number" && mapped.sid_lys > 0) {
    const ratioMap = {
      sid_met_cys_to_lys: "sid_metcys",
      sid_thr_to_lys:     "sid_thr",
      sid_trp_to_lys:     "sid_trp",
      sid_val_to_lys:     "sid_val",
      sid_ile_to_lys:     "sid_ile",
      sid_leu_to_lys:     "sid_leu",
    };
    for (const [rk, reg] of Object.entries(ratioMap)) {
      if (typeof mapped[rk] === "number" && mapped[reg] == null) {
        mapped[reg] = Math.round(mapped[rk] / 100 * mapped.sid_lys * 10000) / 10000;
      }
    }
  }
  if (mapped.avp == null && typeof mapped.sttd_p_ne_ratio === "number" && typeof neVal === "number" && neVal > 0) {
    mapped.avp = Math.round(mapped.sttd_p_ne_ratio * neVal / 10000 * 10000) / 10000;
  }
  // Ca = avp * ca:p ratio (use midpoint of min/max)
  if (mapped.ca == null && typeof mapped.avp === "number" && mapped.avp > 0) {
    const caMin = typeof mapped.ca_to_p_ratio_min === "number" ? mapped.ca_to_p_ratio_min : null;
    const caMax = typeof mapped.ca_to_p_ratio_max === "number" ? mapped.ca_to_p_ratio_max : null;
    const caRatio = caMin != null && caMax != null ? (caMin + caMax) / 2 : caMin || caMax || 1.35;
    mapped.ca = Math.round(mapped.avp * caRatio * 10000) / 10000;
  }
  return {
    mapped,
    applied: looksLibrary,
    rawKeys: Object.keys(raw),
    mappedKeys: Object.keys(mapped),
  };
}

function norm(s) {
  return String(s || "").trim().toLowerCase().replace(/[Ã¢â‚¬Â-Ã¢â‚¬â€œÃ¢â‚¬â€]/g, "-");
}

function normalizeBreedKey(breedIn, typeIn) {
  const b = norm(breedIn).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!b) return "generic";
  const t = norm(typeIn);

  // Broiler-breeder / layer-breeder indexes use compact keys (cobb500, ross308).
  // Do not rewrite those to meat-index keys (cobb_500, ross_308).
  if (t === "broiler_breeder" || t === "layer_breeder") {
    const breederAlias = {
      ross_308: "ross308",
      ross308: "ross308",
      ross_308_ap: "ross308ap",
      ross308ap: "ross308ap",
      ross_308_eu: "ross308_eu",
      ross308_eu: "ross308_eu",
      ross308_f: "ross308",
      ross_708: "ross708",
      ross708: "ross708",
      cobb: "cobb500",
      cobb_500: "cobb500",
      cobb500: "cobb500",
      cobb500_ff: "cobb500",
      cobb500_sf: "cobb500",
      cobb_800: "cobb800_ps",
      cobb800: "cobb800_ps",
      arbor_acres: "arboracresplus",
      arboracres: "arboracresplus",
      hubbard: "hubbard_conv",
    };
    return breederAlias[b] || b;
  }

  const alias = {
    ross_308: "ross308",
    ross_308_ap: "ross308ap",
    ross308ap: "ross308ap",
    ross308_eu: "ross308_eu",
    ross_308_eu: "ross308_eu",
    ross_708: "ross708",
    ross708: "ross708",
    ross: "ross_308",
    ross308: "ross_308",
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

  const profilesWrapped =
    (isObj(libRaw) && isObj(libRaw.profiles) && libRaw.profiles) ||
    (isObj(libRaw) && isObj(libRaw.library) && isObj(libRaw.library.profiles) && libRaw.library.profiles) ||
    null;

  const profiles = profilesWrapped || (isObj(libRaw) ? libRaw : null);

  const production = "meat";
  const breedWanted = normalizeBreedKey(selectors.breed || "generic", selectors.type || "broiler");
  const phaseWanted = normalizePhaseKey(selectors.phase || "starter");

  const breedsNodeA =
    idx &&
    idx.productions &&
    idx.productions[production] &&
    idx.productions[production].breeds;

  const breedsNodeB = idx && idx.breeds;
  const breedsNode = breedsNodeA || breedsNodeB;

  const breedWantedVariants = Array.from(new Set([
    breedWanted,
    String(breedWanted || "").replace(/_/g, ""),
    String(breedWanted || "").replace(/[^a-z0-9]/g, ""),
  ].filter(Boolean)));

  let breedKeyUsed = breedWanted;
  if (breedsNode && isObj(breedsNode)) {
    for (const cand of breedWantedVariants) {
      if (Object.prototype.hasOwnProperty.call(breedsNode, cand)) {
        breedKeyUsed = cand;
        break;
      }
    }
  }

  if (!breedsNode || !isObj(breedsNode)) {
    return {
      ok: false,
      error: "BROILER_INDEX_SCHEMA_INVALID",
      message: "Broiler meat index schema missing breeds mapping.",
      details: {
        indexPath,
        hasProductions: !!idx?.productions,
        hasBreeds: !!idx?.breeds,
      },
    };
  }

  let used_generic_fallback = false;

  let reqKey =
    (breedsNode[breedKeyUsed] && breedsNode[breedKeyUsed][phaseWanted]) ||
    null;

  if (!reqKey && breedsNode.generic && breedsNode.generic[phaseWanted]) {
    used_generic_fallback = true;
    reqKey = breedsNode.generic[phaseWanted];
  }

  if (!reqKey) {
    return {
      ok: false,
      error: "REQUIREMENTS_PHASE_EMPTY",
      message: "No reqKey found for broiler meat selection (breed/phase).",
      details: {
        production,
        breedWanted,
        breedKeyUsed,
        phaseWanted,
        indexPath,
        schema: breedsNodeA ? "A" : "B",
      },
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

  const reqRaw = pickTargets(prof, profiles);

  const meta = {
    requirements_mode: "option_b",
    requirements_wrap_file: null,
    requirements_index_file: indexPath,
    requirements_library_file: libPath,
    production,
    production_inferred: !selectors.production && !selectors.production_type && !selectors.productionType,
    breed_wanted: breedWanted,
    breed_key_used: breedKeyUsed,
    phase_wanted: phaseWanted,
    used_generic_fallback,
    index_schema_used: breedsNodeA ? "A_productions" : "B_breeds",
    requirements_fallback_used: used_generic_fallback,
    requirements_warning: used_generic_fallback
      ? `Requested breed '${breedWanted}' not found in requirements library; using GENERIC targets (NOT breeder-company recommendations).`
      : false,
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
    resolved: {
      reqKey,
      breed: used_generic_fallback ? "generic" : breedKeyUsed,
      phase: phaseWanted,
      production,
    },
    meta,
    source: { mode: "option_b", indexPath, libPath, wrapPath: null },
    sources: { mode: "option_b", indexPath, libPath, wrapPath: null },
  };
}

/**
 * =========================
 * ADDED (minimal integration)
 * =========================
 * These functions are kept before resolveRequirements()
 * so the module is clean and deterministic.
 */

function getBreederOptionBPaths(type) {
  const dbReqBase = path.resolve(__dirname, "../../db/requirements");
  const t = String(type || "").toLowerCase();

  if (t === "broiler_breeder") {
    const base = path.join(dbReqBase, "poultry", "broiler_breeder", "v1");
    return {
      base,
      indexPath: path.join(base, "requirements.index.poultry.broiler_breeder.v1.json"),
      libPath: path.join(base, "requirements.library.poultry.broiler_breeder.v1.json"),
    };
  }

  if (t === "layer_breeder") {
    const base = path.join(dbReqBase, "poultry", "layer_breeder", "v1");
    return {
      base,
      indexPath: path.join(base, "requirements.index.poultry.layer_breeder.v1.json"),
      libPath: path.join(base, "requirements.library.poultry.layer_breeder.v1.json"),
    };
  }

  return null;
}

/**
 * UI dropdowns use generic keys (starter, grower, breeder) while Aviagen/Cobb
 * books use program keys (f_2stage_breeder_1, f_4stage_starter_1, …).
 * Map the mill pick onto the first matching book phase for that breed.
 */
function fuzzyBreederPhaseReqKey(phaseMap, wanted) {
  if (!phaseMap || typeof phaseMap !== "object") return null;
  const w = String(wanted || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!w) return null;
  if (phaseMap[w]) return phaseMap[w];

  const keys = Object.keys(phaseMap);
  const prefer = (cands) => {
    const list = (cands || []).filter(Boolean);
    const order = [/^f_2stage_/, /^f_3stage_/, /^f_4stage_/, /^f_5stage_/, /^f_rear_/, /^f_prod_/, /^/];
    for (const re of order) {
      const hit = list.find((k) => re.test(k));
      if (hit) return phaseMap[hit];
    }
    return list.length ? phaseMap[list[0]] : null;
  };

  const ends = (re) => keys.filter((k) => re.test(k));

  if (w === "breeder" || w === "lay" || w === "laying" || w === "production") {
    return prefer(ends(/(^|_)breeder_1$/) || []) || prefer(ends(/(^|_)breeder$/));
  }
  if (w === "starter" || w === "starter_1") {
    return prefer(ends(/starter_1$/)) || prefer(ends(/starter$/));
  }
  if (w === "starter_2") {
    return prefer(ends(/starter_2$/)) || prefer(ends(/starter$/));
  }
  if (w === "grower") {
    return prefer(ends(/grower$/));
  }
  if (w === "developer") {
    return prefer(ends(/developer$/)) || prefer(ends(/pre_breeder$/)) || prefer(ends(/pre_lay$/));
  }
  if (w === "pre_breeder" || w === "prebreeder" || w === "prelay" || w === "pre_lay") {
    return prefer(ends(/pre_breeder$/)) || prefer(ends(/pre_lay$/));
  }
  if (w === "breeder_1" || w === "breeder_2" || w === "breeder_3") {
    return prefer(ends(new RegExp(w + "$")));
  }

  const contains = keys.filter((k) => k.includes(w) || w.includes(k));
  return prefer(contains);
}

function resolveBreederOptionB(selectors) {
  const t = String(selectors.type || "").toLowerCase();
  const paths = getBreederOptionBPaths(t);

  if (!paths) {
    return {
      ok: false,
      error: "BREEDER_TYPE_UNSUPPORTED",
      message: "Breeder type not supported by Option-B breeder resolver.",
      details: { type: selectors.type || null },
    };
  }

  const { indexPath, libPath } = paths;

  if (!fs.existsSync(indexPath) || !fs.existsSync(libPath)) {
    return {
      ok: false,
      error: "BREEDER_OPTIONB_FILES_MISSING",
      message: "Breeder Option-B index/library files not found.",
      details: { indexPath, libPath },
    };
  }

  const idx = readJsonBOMSafe(indexPath);
  const libRaw = readJsonBOMSafe(libPath);

  const profilesWrapped =
    (isObj(libRaw) && isObj(libRaw.profiles) && libRaw.profiles) ||
    (isObj(libRaw) && isObj(libRaw.library) && isObj(libRaw.library.profiles) && libRaw.library.profiles) ||
    null;

  const profiles = profilesWrapped || (isObj(libRaw) ? libRaw : null);

  const productionWanted = norm(selectors.production || "breeder") || "breeder";
  const breedWanted = normalizeBreedKey(selectors.breed || "generic", selectors.type || "broiler");
  const phaseWanted = norm(selectors.phase || "starter")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const breedsNodeA =
    idx &&
    idx.productions &&
    idx.productions[productionWanted] &&
    idx.productions[productionWanted].breeds;

  const breedsNodeB = idx && idx.breeds;
  const breedsNode = breedsNodeA || breedsNodeB;

  if (!breedsNode || !isObj(breedsNode)) {
    return {
      ok: false,
      error: "BREEDER_INDEX_SCHEMA_INVALID",
      message: "Breeder index schema missing breeds mapping.",
      details: {
        indexPath,
        hasProductions: !!idx?.productions,
        hasBreeds: !!idx?.breeds,
        productionWanted,
      },
    };
  }

  // Apply breed_aliases from index if present
  const breedAliasMap = (idx && isObj(idx.breed_aliases)) ? idx.breed_aliases : {};
  const breedAliased = breedAliasMap[breedWanted] || breedWanted;

  const breedVariants = Array.from(new Set([
    breedAliased,
    breedWanted,
    String(breedWanted || "").replace(/_/g, ""),
    String(breedWanted || "").replace(/[^a-z0-9]/g, ""),
    norm(selectors.breed || "").replace(/[^a-z0-9]/g, ""),
    norm(selectors.breed || "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
  ].filter(Boolean)));

  let breedKeyUsed = breedAliased;
  for (const cand of breedVariants) {
    if (Object.prototype.hasOwnProperty.call(breedsNode, cand)) {
      breedKeyUsed = cand;
      break;
    }
  }

  let used_generic_fallback = false;

  const breedNode = (breedsNode && breedsNode[breedKeyUsed]) ? breedsNode[breedKeyUsed] : null;
  const phaseMap = (breedNode && isObj(breedNode.phases)) ? breedNode.phases : breedNode;

  // Apply phase_aliases from index if present
  const phaseAliasMap = (idx && isObj(idx.phase_aliases)) ? idx.phase_aliases : {};
  const phaseResolved = phaseAliasMap[phaseWanted] || phaseWanted;

  let reqKey = (phaseMap && phaseMap[phaseResolved]) ? phaseMap[phaseResolved]
    : (phaseMap && phaseMap[phaseWanted]) ? phaseMap[phaseWanted] : null;

  if (!reqKey && phaseMap) {
    reqKey = fuzzyBreederPhaseReqKey(phaseMap, phaseResolved)
      || fuzzyBreederPhaseReqKey(phaseMap, phaseWanted);
  }

  if (!reqKey && breedsNode && breedsNode.generic) {
    const g = breedsNode.generic;
    const gPhaseMap = (g && isObj(g.phases)) ? g.phases : g;
    reqKey = (gPhaseMap && gPhaseMap[phaseResolved]) ? gPhaseMap[phaseResolved]
      : (gPhaseMap && gPhaseMap[phaseWanted]) ? gPhaseMap[phaseWanted] : null;
    if (reqKey) used_generic_fallback = true;
  }

  if (!reqKey) {
    return {
      ok: false,
      error: "REQUIREMENTS_PHASE_EMPTY",
      message: "No reqKey found for breeder selection (breed/phase).",
      details: {
        type: t,
        productionWanted,
        breedWanted,
        breedKeyUsed,
        phaseWanted,
        indexPath,
        schema: breedsNodeA ? "A_productions" : "B_breeds",
      },
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

  const reqRaw = pickTargets(prof, profiles);

  const meta = {
    requirements_mode: "option_b",
    requirements_wrap_file: null,
    requirements_index_file: indexPath,
    requirements_library_file: libPath,
    production: productionWanted,
    production_inferred: !selectors.production && !selectors.production_type && !selectors.productionType,
    breed_wanted: breedWanted,
    breed_key_used: breedKeyUsed,
    phase_wanted: phaseWanted,
    used_generic_fallback,
    index_schema_used: breedsNodeA ? "A_productions" : "B_breeds",
    requirements_fallback_used: used_generic_fallback,
    requirements_warning: used_generic_fallback
      ? `Requested breed '${breedWanted}' not found in requirements library; using GENERIC targets (NOT breeder-company recommendations).`
      : false,
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
    resolved: {
      reqKey,
      breed: used_generic_fallback ? "generic" : breedKeyUsed,
      phase: phaseWanted,
      production: productionWanted,
      type: t,
    },
    meta,
    source: { mode: "option_b", indexPath, libPath, wrapPath: null },
    sources: { mode: "option_b", indexPath, libPath, wrapPath: null },
  };
}

/**
 * =========================
 * ADDED (minimal integration)
 * =========================
 * Layer Option-B resolver
 */

function getLayerOptionBPaths() {
  const dbReqBase = path.resolve(__dirname, "../../db/requirements");
  const base = path.join(dbReqBase, "poultry", "layer", "v1");

  return {
    base,
    indexPath: path.join(base, "requirements.index.poultry.layer.v1.json"),
    libPath: path.join(base, "requirements.library.poultry.layer.v1.json"),
  };
}

function resolveLayerOptionB(selectors) {
  const { indexPath, libPath } = getLayerOptionBPaths();

  if (!fs.existsSync(indexPath) || !fs.existsSync(libPath)) {
    return {
      ok: false,
      error: "LAYER_OPTIONB_FILES_MISSING",
      message: "Layer Option-B index/library files not found.",
      details: { indexPath, libPath },
    };
  }

  const idx = readJsonBOMSafe(indexPath);
  const libRaw = readJsonBOMSafe(libPath);

  const profilesWrapped =
    (isObj(libRaw) && isObj(libRaw.profiles) && libRaw.profiles) ||
    (isObj(libRaw) && isObj(libRaw.library) && isObj(libRaw.library.profiles) && libRaw.library.profiles) ||
    null;

  const profiles = profilesWrapped || (isObj(libRaw) ? libRaw : null);

  const productionWanted = norm(selectors.production || "egg") || "egg";
  const breedWanted = normalizeBreedKey(selectors.breed || "generic", selectors.type || "broiler");
  const phaseWanted = norm(selectors.phase || "starter")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const breedsNodeA =
    idx &&
    idx.productions &&
    idx.productions[productionWanted] &&
    idx.productions[productionWanted].breeds;

  const breedsNodeB = idx && idx.breeds;
  const breedsNode = breedsNodeA || breedsNodeB;

  if (!breedsNode || !isObj(breedsNode)) {
    return {
      ok: false,
      error: "LAYER_INDEX_SCHEMA_INVALID",
      message: "Layer index schema missing breeds mapping.",
      details: {
        indexPath,
        hasProductions: !!idx?.productions,
        hasBreeds: !!idx?.breeds,
        productionWanted,
      },
    };
  }

  const breedAliases = (idx && isObj(idx.breed_aliases)) ? idx.breed_aliases : {};
  const breedAliasResolved = breedAliases[breedWanted] || breedWanted;

  const breedVariants = Array.from(new Set([
    breedAliasResolved,
    breedWanted,
    String(breedAliasResolved || "").replace(/_/g, ""),
    String(breedAliasResolved || "").replace(/[^a-z0-9]/g, ""),
    String(breedWanted || "").replace(/_/g, ""),
    String(breedWanted || "").replace(/[^a-z0-9]/g, ""),
    norm(selectors.breed || "").replace(/[^a-z0-9]/g, ""),
    norm(selectors.breed || "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
  ].filter(Boolean)));

  let breedKeyUsed = breedAliasResolved;
  for (const cand of breedVariants) {
    if (Object.prototype.hasOwnProperty.call(breedsNode, cand)) {
      breedKeyUsed = cand;
      break;
    }
  }

  let used_generic_fallback = false;

  const breedNode = (breedsNode && breedsNode[breedKeyUsed]) ? breedsNode[breedKeyUsed] : null;
  const phaseMap = (breedNode && isObj(breedNode.phases)) ? breedNode.phases : breedNode;

  let reqKey = (phaseMap && phaseMap[phaseWanted]) ? phaseMap[phaseWanted] : null;

  if (!reqKey && breedsNode && breedsNode.generic) {
    const g = breedsNode.generic;
    const gPhaseMap = (g && isObj(g.phases)) ? g.phases : g;
    reqKey = (gPhaseMap && gPhaseMap[phaseWanted]) ? gPhaseMap[phaseWanted] : null;
    if (reqKey) used_generic_fallback = true;
  }

  if (!reqKey) {
    return {
      ok: false,
      error: "REQUIREMENTS_PHASE_EMPTY",
      message: "No reqKey found for layer selection (breed/phase).",
      details: {
        productionWanted,
        breedWanted,
        breedAliasResolved,
        breedKeyUsed,
        phaseWanted,
        indexPath,
        schema: breedsNodeA ? "A_productions" : "B_breeds",
        availableBreedKeys: Object.keys(breedsNode).slice(0, 50),
      },
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

  const reqRaw = pickTargets(prof, profiles);

  const meta = {
    requirements_mode: "option_b",
    requirements_wrap_file: null,
    requirements_index_file: indexPath,
    requirements_library_file: libPath,
    production: productionWanted,
    production_inferred: !selectors.production && !selectors.production_type && !selectors.productionType,
    breed_wanted: breedWanted,
    breed_alias_resolved: breedAliasResolved,
    breed_key_used: breedKeyUsed,
    phase_wanted: phaseWanted,
    used_generic_fallback,
    index_schema_used: breedsNodeA ? "A_productions" : "B_breeds",
    requirements_fallback_used: used_generic_fallback,
    requirements_warning: used_generic_fallback
      ? `Requested breed '${breedWanted}' not found in requirements library; using GENERIC targets (NOT breeder-company recommendations).`
      : false,
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
    resolved: {
      reqKey,
      breed: used_generic_fallback ? "generic" : breedKeyUsed,
      phase: phaseWanted,
      production: productionWanted,
      type: "layer",
    },
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

  // ---- Option-B breeder resolvers (forced) ----
  if (
    String(input.species).toLowerCase() === "poultry" &&
    (String(input.type).toLowerCase() === "broiler_breeder" || String(input.type).toLowerCase() === "layer_breeder")
  ) {
    const rb = resolveBreederOptionB({ ...input });

    if (rb && rb.ok === true) {
      const mapped = mapLibraryKeysToRegistry(rb.requirements || {});
      const meta = isObj(rb.meta) ? { ...rb.meta } : {};

      meta.requirements_targets_raw = extractNumericFlat(rb.requirements || {});
      meta.requirements_targets_raw_keys_used = mapped.rawKeys;
      meta.requirements_targets_mapped_keys_used = mapped.mappedKeys;
      meta.requirements_targets_mapping_applied = mapped.applied;

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
  }

  // ---- Option-B layer resolver (forced) ----
  if (
    String(input.species).toLowerCase() === "poultry" &&
    String(input.type).toLowerCase() === "layer"
  ) {
    const rb = resolveLayerOptionB({ ...input });

    if (rb && rb.ok === true) {
      const mapped = mapLibraryKeysToRegistry(rb.requirements || {});
      const meta = isObj(rb.meta) ? { ...rb.meta } : {};

      meta.requirements_targets_raw = extractNumericFlat(rb.requirements || {});
      meta.requirements_targets_raw_keys_used = mapped.rawKeys;
      meta.requirements_targets_mapped_keys_used = mapped.mappedKeys;
      meta.requirements_targets_mapping_applied = mapped.applied;

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
  }

  // ---- Canonical broiler meat resolver (forced) ----
  if (
    String(input.species).toLowerCase() === "poultry" &&
    String(input.type).toLowerCase() === "broiler"
  ) {
    const rb = resolveBroilerMeatOptionB({ ...input, production: "meat" });

    if (rb && rb.ok === true) {
      const mapped = mapLibraryKeysToRegistry(rb.requirements || {});
      const meta = isObj(rb.meta) ? { ...rb.meta } : {};

      meta.requirements_targets_raw = extractNumericFlat(rb.requirements || {});
      meta.requirements_targets_raw_keys_used = mapped.rawKeys;
      meta.requirements_targets_mapped_keys_used = mapped.mappedKeys;
      meta.requirements_targets_mapping_applied = mapped.applied;

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
  }

  // ---- Option-B breeder resolvers (ADD) ----
  // NOTE: kept for traceability (do not delete), but disabled to avoid double-execution.
  if (false) {
    if (
      String(input.species).toLowerCase() === "poultry" &&
      (String(input.type).toLowerCase() === "broiler_breeder" || String(input.type).toLowerCase() === "layer_breeder")
    ) {
      const rb = resolveBreederOptionB({ ...input });

      if (rb && rb.ok === true) {
        const mapped = mapLibraryKeysToRegistry(rb.requirements || {});
        const meta = isObj(rb.meta) ? { ...rb.meta } : {};

        meta.requirements_targets_raw = extractNumericFlat(rb.requirements || {});
        meta.requirements_targets_raw_keys_used = mapped.rawKeys;
        meta.requirements_targets_mapped_keys_used = mapped.mappedKeys;
        meta.requirements_targets_mapping_applied = mapped.applied;

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
    }
  }

  // ---- Fallback: DB loader for non-explicit branches ----
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