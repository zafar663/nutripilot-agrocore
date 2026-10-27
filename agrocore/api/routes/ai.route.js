import express from "express";
import OpenAI from "openai";
import { createRequire } from "node:module";
import path from "path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const fs = require("fs");

const router = express.Router();

// Supports Groq (via OPENAI_BASE_URL override) or native OpenAI
const DEFAULT_MODEL = process.env.NUTRIX_AI_MODEL || "llama-3.3-70b-versatile";

// ─── Nutrix Feature Guide (for how-to/help questions) ────────────────────────
let _nutrixFeatureGuide = null;
function loadFeatureGuide() {
  if (_nutrixFeatureGuide) return _nutrixFeatureGuide;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "../../data/nutrix-feature-guide.json"),
    path.resolve(process.cwd(), "agrocore/data/nutrix-feature-guide.json"),
    path.resolve(process.cwd(), "data/nutrix-feature-guide.json")
  ];
  for (const guidePath of candidates) {
    try {
      if (fs.existsSync(guidePath)) {
        _nutrixFeatureGuide = JSON.parse(fs.readFileSync(guidePath, "utf8"));
        return _nutrixFeatureGuide;
      }
    } catch { /* try next */ }
  }
  _nutrixFeatureGuide = { features: [] };
  return _nutrixFeatureGuide;
}

const HELP_QUESTION_REGEX = /\b(how|what|where|explain|confused|help|guide|tutorial|manual|function|do i|do you|can i|can you|tell me|show me|what is|what are|how do|how to|how can|doesn't work|not working|find my|where can)\b/i;

function scoreFeature(f, q) {
  let score = 0;
  const aliases = [f.id?.replace(/-/g, " "), f.title, f.tab, ...(f.aliases || [])]
    .map(a => String(a || "").toLowerCase().trim())
    .filter(Boolean);
  for (const a of aliases) {
    if (q.includes(a)) score += a.length > 8 ? 10 : 8;
  }
  const searchText = [f.id, f.title, f.description, f.how_to, ...(f.tips || []), ...(f.aliases || [])].join(" ").toLowerCase();
  const words = q.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 3);
  for (const w of words) {
    if (searchText.includes(w)) score++;
  }
  return score;
}

function matchFeatureGuide(question) {
  const guide = loadFeatureGuide();
  const q = String(question || "").toLowerCase();
  const scored = (guide.features || [])
    .map(f => ({ feature: f, score: scoreFeature(f, q) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

function formatFeatureAnswer(f) {
  const tips = (f.tips || []).map(t => `• ${t}`).join("\n");
  return `**${f.title}**\n\n${f.description}\n\n**How to use**\n${f.how_to}${tips ? `\n\n**Tips**\n${tips}` : ""}`.trim();
}

function findFeatureGuideContext(question) {
  if (!HELP_QUESTION_REGEX.test(question) && !matchFeatureGuide(question)) return null;
  const guide = loadFeatureGuide();
  const q = String(question || "").toLowerCase();
  const scored = (guide.features || [])
    .map(f => ({ feature: f, score: scoreFeature(f, q) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const top = scored.slice(0, 3).map(x => x.feature);
  return top.map(f =>
    `\n\n## Nutrix Feature: ${f.title}\n${f.description}\n\nHow to use: ${f.how_to}\n\nTips:\n${(f.tips || []).map(t => `- ${t}`).join("\n")}`
  ).join("\n");
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function compactContext(context = {}) {
  return {
    channel:  safeText(context.channel,  "web"),
    module:   safeText(context.module,   "formulation"),
    species:  safeText(context.species),
    type:     safeText(context.type),
    production: safeText(context.production),
    breed:    safeText(context.breed),
    sex:      safeText(context.sex),
    phase:    safeText(context.phase),
    mill_id:  safeText(context.mill_id),
    manual_topic_id: safeText(context.manual_topic_id),
    formula_context_enabled: context.formula_context_enabled !== false
  };
}

function nutrientLabel(key) {
  const raw = String(key == null ? "" : key).trim();
  if (!raw) return "";
  const k = raw.toLowerCase();
  const MAP = {
    me_kcal_per_kg:"ME (kcal/kg)", me_kcal_kg:"ME (kcal/kg)", me:"ME (kcal/kg)",
    ne_kcal_kg:"NE (kcal/kg)", ne_kcal_per_kg:"NE (kcal/kg)",
    me_mj_per_kg:"ME (MJ/kg)", me_mj:"ME (MJ/kg)",
    // Equine uses DE (digestible energy)
    de_mcal_per_kg:"DE (Mcal/kg)", de_mj_per_kg:"DE (MJ/kg)",
    cp_pct:"CP (%)", cp:"CP (%)", dm_pct:"DM (%)",
    ee_pct:"EE/Fat (%)", cf_pct:"Crude Fibre (%)",
    ca_pct:"Ca (%)", ca:"Ca (%)", calcium_pct:"Ca (%)",
    total_p_pct:"Total P (%)", avp_pct:"avP (%)", avp:"avP (%)",
    avail_p_pct:"Avail P (%)", sttd_p_pct:"STTD P (%)",
    p_pct:"P (%)",
    na_pct:"Na (%)", na:"Na (%)", sodium_pct:"Na (%)",
    k_pct:"K (%)", cl_pct:"Cl (%)", mg_pct:"Mg (%)", s_pct:"S (%)",
    deb_meq_per_kg:"dEB (mEq/kg)",
    // Trace minerals (equine & other)
    cu_ppm:"Cu (ppm)", zn_ppm:"Zn (ppm)", mn_ppm:"Mn (ppm)",
    fe_ppm:"Fe (ppm)", se_ppm:"Se (ppm)", i_ppm:"I (ppm)", co_ppm:"Co (ppm)",
    // Vitamins (equine)
    vit_a_iu_per_kg:"Vit A (IU/kg)", vit_d_iu_per_kg:"Vit D (IU/kg)",
    vit_e_iu_per_kg:"Vit E (IU/kg)", biotin_ppm:"Biotin (ppm)",
    // Fiber / NSC (equine metabolic)
    ndf_pct_min:"NDF min (%)", adf_pct_min:"ADF min (%)",
    starch_pct_max:"Starch max (%)", nsc_pct_max:"NSC max (%)",
    sid_lys_pct:"SID Lys (%)", lys_pct:"Lys (%)",
    sid_met_pct:"SID Met (%)", met_pct:"Met (%)",
    sid_metcys_pct:"SID Met+Cys (%)", metcys_pct:"Met+Cys (%)",
    sid_thr_pct:"SID Thr (%)", thr_pct:"Thr (%)",
    sid_trp_pct:"SID Trp (%)", trp_pct:"Trp (%)",
    sid_arg_pct:"SID Arg (%)", arg_pct:"Arg (%)",
    sid_val_pct:"SID Val (%)", sid_ile_pct:"SID Ile (%)",
    sid_leu_pct:"SID Leu (%)", sid_his_pct:"SID His (%)",
    sid_phe_pct:"SID Phe (%)", sid_tyr_pct:"SID Tyr (%)",
    lys_ne_ratio_g_mcal:"Lys:NE (g/Mcal)", lys_me_ratio_g_mcal:"Lys:ME (g/Mcal)",
    sttd_p_ne_ratio_g_mcal:"STTD P:NE (g/Mcal)", sttd_p_me_ratio_g_mcal:"STTD P:ME (g/Mcal)",
    avail_p_ne_ratio_g_mcal:"Avail P:NE (g/Mcal)", avail_p_me_ratio_g_mcal:"Avail P:ME (g/Mcal)",
    ca_to_p_ratio:"Ca:P Ratio", ca_to_p_ratio_analyzed:"Ca:P Ratio (w/ phytase)", ca_to_p_ratio_no_phytase:"Ca:P Ratio (no phytase)",
    chloride_pct:"Cl (%)", sodium_pct:"Na (%)", ndf_min_pct:"NDF min (%)", linoleic_acid_pct:"Linoleic Acid (%)",
    lys_min_g_day:"SID Lys min (g/day)", sttd_p_ne_ratio_g_mcal_herd:"STTD P:NE (g/Mcal, herd)"
  };
  if (MAP[k]) return MAP[k];
  const m = k.match(/^(sid|total|std|ap|dig)_(.+?)(?:_pct)?$/);
  if (m) {
    const AA = {lys:"Lys",met:"Met",cys:"Cys",metcys:"Met+Cys",thr:"Thr",trp:"Trp",arg:"Arg",val:"Val",ile:"Ile",leu:"Leu",his:"His",phe:"Phe",tyr:"Tyr"};
    const pfx = m[1]==="sid"?"SID":m[1]==="total"?"Total":m[1].toUpperCase();
    const aa = AA[m[2]] || (m[2].charAt(0).toUpperCase()+m[2].slice(1));
    return `${pfx} ${aa}`;
  }
  return raw.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
}

// ─── Library catalog ─────────────────────────────────────────────────────────

const C = path.resolve(process.cwd(), "core");       // /var/www/nutripilot-agrocore/core
const CDB = path.join(C, "db", "requirements");       // core/db/requirements
const CREQ = path.join(C, "requirements");            // core/requirements

// ─── Performance index + library (for universal perf query support) ───────────
import { readFileSync as _rfs, existsSync as _ex } from 'node:fs';

let _perfIndex = {};
let _perfLibrary = {};
try {
  _perfIndex = JSON.parse(_rfs(path.join(CDB, 'performance.index.v1.json'), 'utf8'));
  const _libs = [
    path.join(CDB, 'performance.library.all_breeds.v2025.json'),
    path.join(CDB, 'performance.library.dairy.v2025.json'),
    path.join(CDB, 'performance.library.beef.v2025.json'),
    path.join(CDB, 'sheep',       'performance.library.sheep.v2025.json'),
    path.join(CDB, 'goat',        'performance.library.goat.v2025.json'),
    path.join(CDB, 'aquaculture', 'performance.library.aquaculture.v2025.json'),
    path.join(CDB, 'camelid',     'performance.library.camelid.v2025.json'),
    path.join(CDB, 'companion',   'performance.library.companion.v2025.json'),
    path.join(CDB, 'rabbit',      'performance.library.rabbit.v2025.json'),
  ];
  for (const lp of _libs) {
    if (_ex(lp)) Object.assign(_perfLibrary, JSON.parse(_rfs(lp, 'utf8')));
  }
  // Load equine libs into _perfLibrary
  for (const [key, sub] of [['equine','performance.library.equine.v2025.json'],['equine_donkey','performance.library.donkey.v2025.json'],['equine_mule','performance.library.mule.v2025.json']]) {
    const ep = path.join(CDB, 'equine', key.replace('equine_',''), sub);
    if (_ex(ep)) _perfLibrary[key] = { ...(_perfLibrary[key]||{}), ...JSON.parse(_rfs(ep, 'utf8')) };
  }
} catch(e) { console.warn('[AI] Performance index/library load failed:', e.message); }

function _flatPerfIndex(obj, out={}) {
  for (const [k,v] of Object.entries(obj)) {
    if (k === '_meta') continue;
    if (typeof v === 'string') out[k.toLowerCase()] = v;
    else if (typeof v === 'object') _flatPerfIndex(v, out);
  }
  return out;
}
const _perfFlat = _flatPerfIndex(_perfIndex);

function _loadPerfFile(relPath) {
  if (!relPath) return null;
  if (relPath.startsWith('library:')) {
    const key = relPath.replace('library:', '');
    const dot = key.indexOf('.');
    const section = key.substring(0, dot);
    const breed   = key.substring(dot + 1);
    return (_perfLibrary[section]||{})[breed] ?? null;
  }
  try {
    const full = path.join(CDB, ...relPath.split('/'));
    return _ex(full) ? JSON.parse(_rfs(full, 'utf8')) : null;
  } catch { return null; }
}

// breedFilter → performance index key normalization
const _PERF_KEY_OVERRIDES = {
  hubbard:'hubbard_efficiency_plus', hubbard_conv:'hubbard_efficiency_plus',
  aa:'arbor_acres_plus', arboracresplus:'arbor_acres_plus',
  ross308ap:'ross_308', ross308_ap:'ross_308',
  ross308_eu:'ross_308_eu', ross308_f:'ross_308_ap',
  ross708:'ross_708', cobb500_ff:'cobb_500_ff', cobb500_sf:'cobb_500_sf',
  cobb800_ps:'cobb_800_ps', cobb700_ps:'cobb_700_ps',
  nrc2026:null, generic:null,
};

function _perfKeyFromEntry(breedFilter, label) {
  if (!breedFilter) {
    const lbl = (label||'').toLowerCase();
    if (lbl.includes('danbred'))                         return 'danbred';
    if (lbl.includes('tn70') || lbl.includes('topigs')) return 'topigs_tn70';
    if (lbl.includes('pic 337') || lbl.includes('pic337')) return 'pic_337';
    if (lbl.includes('cherry valley') && lbl.includes('layer')) return 'cherry_valley_layer';
    if (lbl.includes('cherry valley'))                   return 'cherry_valley_meat';
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(_PERF_KEY_OVERRIDES, breedFilter)) return _PERF_KEY_OVERRIDES[breedFilter];
  return breedFilter.replace(/([a-z])(\d)/g,'$1_$2');
}

function _lookupBreedPerf(breedFilter, label, question) {
  let key = _perfKeyFromEntry(breedFilter, label);
  // For generic swine entries with no brand in label, route by question content
  if (!key) {
    const lbl = (label||'').toLowerCase();
    if (lbl.includes('swine') || lbl.includes('pig')) {
      const q = (question||'').toLowerCase();
      if (q.includes('gilt') || q.includes('developer') || q.includes('development') || q.includes('replacement')) key = 'gilt_development';
      else if (q.includes('sow') || q.includes('farrowing') || q.includes('lactating sow') || q.includes('gestating sow')) key = 'topigs_tn70';
      else if (q.includes('grower') || q.includes('finisher') || q.includes('market pig') || q.includes('grow-finish')) key = 'pic_337';
      else key = 'gilt_development'; // sensible fallback for unspecified swine performance
    }
  }
  if (!key) return null;
  const relPath = _perfFlat[key.toLowerCase()];
  if (!relPath) return null;
  const data = _loadPerfFile(relPath);
  if (!data) return null;
  // If file is the breed itself (no nesting) return directly
  if (data.curve || data.phases || data._meta || data.development_phases) return data;
  // Shouldn't happen for direct files, but handle nested
  return data[key] || Object.values(data).find(v => v && typeof v === 'object' && v._meta) || null;
}

function isPerformanceQuery(question) {
  return /body\s*wt|body\s*weight|\bbw\b|growth\s*(rate|curve|standard|performance)|feed\s*conv(ersion)?|\bfcr\b|\badg\b|avg\s*daily\s*gain|average\s*daily\s*gain|market\s*weight|harvest\s*weight|slaughter\s*weight|finish\s*weight|target\s*weight|breed\s*standard|production\s*perform|performance\s*standard|how\s*(heavy|fast|big|much.*weigh)|weight\s*at\s*(age|\d)|survival\s*rate|egg\s*prod(uction)?|lay.*percent|peak\s*(lay|prod)|milk\s*yield|fleece|fiber\s*(diameter|yield)|litter\s*size|weaning\s*weight|sgr\b|specific\s*growth|mortality\s*rate|dressing\s*(pct|percent)|\/day.*growth/i.test(question);
}

// Each entry: { triggers, species, label, file, breedFilter, structType }
// structType: "profiles_targets" | "profiles_phases" | "profiles_inherit_phases" | "swine_phases" | "equine_dynamic"
const LIBRARY_CATALOG = [

  // ── Broiler ──────────────────────────────────────────────────────────────
  { triggers:["ross 308","ross308","ross-308","ross308ap","ross"],
    species:"broiler", label:"Broiler – Ross 308",
    file:`${CDB}/poultry/broiler/meat/library.poultry_broiler_meat.v1.json`,
    breedFilter:"ross308", structType:"profiles_targets" },

  { triggers:["cobb 500","cobb500","cobb-500","cobb 800","cobb800","cobb"],
    species:"broiler", label:"Broiler – Cobb 500",
    file:`${CDB}/poultry/broiler/meat/library.poultry_broiler_meat.v1.json`,
    breedFilter:"cobb500", structType:"profiles_targets" },

  { triggers:["hubbard","efficiency plus","efficiency_plus"],
    species:"broiler", label:"Broiler – Hubbard Efficiency+",
    file:`${CDB}/poultry/broiler/meat/library.poultry_broiler_meat.v1.json`,
    breedFilter:"hubbard", structType:"profiles_targets" },

  { triggers:["arbor acres","arbor_acres","arbor acres plus","aa plus","aviagen aa","arbor","aa"],
    species:"broiler", label:"Broiler – Arbor Acres",
    file:`${CDB}/poultry/broiler/meat/library.poultry_broiler_meat.v1.json`,
    breedFilter:"aa", structType:"profiles_targets" },

  { triggers:["broiler"],
    species:"broiler", label:"Broiler – Generic",
    file:`${CDB}/poultry/broiler/meat/library.poultry_broiler_meat.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  // ── Broiler Breeder — full CDB library (97 profiles) ────────────────────
  // Each broiler breeder entry includes "broiler breeder","parent","ps" so queries
  // containing those words score 2+ here vs 1 for the plain broiler entries.
  { triggers:["ross 308 ap","ross308ap","ross ap","ross 308ap","broiler breeder","parent","ps","ross"],
    species:"broiler_breeder", label:"Broiler Breeder – Ross 308 AP",
    file:`${CDB}/poultry/broiler_breeder/v1/requirements.library.poultry.broiler_breeder.v1.json`,
    breedFilter:"ross308ap", structType:"profiles_targets" },

  { triggers:["ross 708","ross708","ross-708","broiler breeder","parent","ps"],
    species:"broiler_breeder", label:"Broiler Breeder – Ross 708",
    file:`${CDB}/poultry/broiler_breeder/v1/requirements.library.poultry.broiler_breeder.v1.json`,
    breedFilter:"ross708", structType:"profiles_targets" },

  { triggers:["ross 308 eu","ross308 eu","ross eu","european ross","broiler breeder","parent","ps"],
    species:"broiler_breeder", label:"Broiler Breeder – Ross 308 EU",
    file:`${CDB}/poultry/broiler_breeder/v1/requirements.library.poultry.broiler_breeder.v1.json`,
    breedFilter:"ross308_eu", structType:"profiles_targets" },

  { triggers:["ross 308","ross308","ross-308","ross ps","breeder ross","ross parent","broiler breeder","parent","ps"],
    species:"broiler_breeder", label:"Broiler Breeder – Ross 308 PS",
    file:`${CDB}/poultry/broiler_breeder/v1/requirements.library.poultry.broiler_breeder.v1.json`,
    breedFilter:"ross308_f", structType:"profiles_targets" },

  { triggers:["cobb 500 ff","cobb500 ff","cobb ff","cobb feeder free","cobb500ff","broiler breeder","parent","ps"],
    species:"broiler_breeder", label:"Broiler Breeder – Cobb 500 FF",
    file:`${CDB}/poultry/broiler_breeder/v1/requirements.library.poultry.broiler_breeder.v1.json`,
    breedFilter:"cobb500_ff", structType:"profiles_targets" },

  { triggers:["cobb 500 sf","cobb500 sf","cobb sf","cobb separate fed","cobb500sf","broiler breeder","parent","ps"],
    species:"broiler_breeder", label:"Broiler Breeder – Cobb 500 SF",
    file:`${CDB}/poultry/broiler_breeder/v1/requirements.library.poultry.broiler_breeder.v1.json`,
    breedFilter:"cobb500_sf", structType:"profiles_targets" },

  { triggers:["cobb 800","cobb800","cobb-800","cobb 800 ps","broiler breeder","parent","ps"],
    species:"broiler_breeder", label:"Broiler Breeder – Cobb 800",
    file:`${CDB}/poultry/broiler_breeder/v1/requirements.library.poultry.broiler_breeder.v1.json`,
    breedFilter:"cobb800_ps", structType:"profiles_targets" },

  { triggers:["cobb breeder","cobb ff","cobb sf","cobb parent","breeder cobb","cobb 500 breeder","broiler breeder","parent","ps","cobb"],
    species:"broiler_breeder", label:"Broiler Breeder – Cobb 500",
    file:`${CDB}/poultry/broiler_breeder/v1/requirements.library.poultry.broiler_breeder.v1.json`,
    breedFilter:"cobb500", structType:"profiles_targets" },

  // "arbor acres" added so basic "Arbor Acres Plus breeder" query matches; scores 2 when "broiler breeder"/"parent" also in query
  { triggers:["arbor acres","arbor acres breeder","arbor acres ps","aa plus breeder","arbor acres parent","aa breeder","broiler breeder","parent","ps"],
    species:"broiler_breeder", label:"Broiler Breeder – Arbor Acres Plus",
    file:`${CDB}/poultry/broiler_breeder/v1/requirements.library.poultry.broiler_breeder.v1.json`,
    breedFilter:"arboracresplus", structType:"profiles_targets" },

  { triggers:["hubbard breeder","hubbard conv","hubbard parent","hubbard ps","broiler breeder","parent","ps"],
    species:"broiler_breeder", label:"Broiler Breeder – Hubbard Conv",
    file:`${CDB}/poultry/broiler_breeder/v1/requirements.library.poultry.broiler_breeder.v1.json`,
    breedFilter:"hubbard_conv", structType:"profiles_targets" },

  { triggers:["broiler breeder","parent flock","ps flock","broiler parent","breeder broiler"],
    species:"broiler_breeder", label:"Broiler Breeder – NRC2026",
    file:`${CDB}/poultry/broiler_breeder/v1/requirements.library.poultry.broiler_breeder.v1.json`,
    breedFilter:"nrc2026", structType:"profiles_targets" },

  // ── Layer — all breeds from CDB full library ─────────────────────────────
  // Dekalb White (Hendrix Genetics)
  { triggers:["dekalb white","dekalb_white","dekalb"],
    species:"layer", label:"Layer – Dekalb White",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"dekalb_white", structType:"profiles_targets" },

  // ISA Brown
  { triggers:["isa brown","isa_brown","isabrown","isa 2","isa bruine","isa"],
    species:"layer", label:"Layer – ISA Brown",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"isa_brown", structType:"profiles_targets" },

  // Lohmann Brown variants — each includes "lohmann brown"+"lohmann" so specific entries
  // always outscore the generic "lohmann" catch-all entry below (score 3 vs 2)
  { triggers:["lohmann brown classic","lohmann_brown_classic","lohmann brown","lohmann"],
    species:"layer", label:"Layer – Lohmann Brown Classic",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"lohmann_brown_classic", structType:"profiles_targets" },
  { triggers:["lohmann brown extra","lohmann_brown_extra","lohmann brown","lohmann"],
    species:"layer", label:"Layer – Lohmann Brown Extra",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"lohmann_brown_extra", structType:"profiles_targets" },
  { triggers:["lohmann brown lite","lohmann_brown_lite","lohmann brown lite na","lohmann brown","lohmann"],
    species:"layer", label:"Layer – Lohmann Brown Lite NA",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"lohmann_brown_lite_na", structType:"profiles_targets" },
  { triggers:["lohmann brown","lohmann_brown","lohmann"],
    species:"layer", label:"Layer – Lohmann Brown Classic",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"lohmann_brown_classic", structType:"profiles_targets" },

  // Lohmann LSL variants — include "lohmann lsl"+"lsl"+"lohmann" to beat generic catch-all
  { triggers:["lohmann lsl classic","lohmann_lsl_classic","lsl classic","lohmann lsl","lsl","lohmann"],
    species:"layer", label:"Layer – Lohmann LSL Classic",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"lohmann_lsl_classic", structType:"profiles_targets" },
  { triggers:["lohmann lsl extra","lohmann_lsl_extra","lsl extra","lohmann lsl","lsl","lohmann"],
    species:"layer", label:"Layer – Lohmann LSL Extra",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"lohmann_lsl_extra", structType:"profiles_targets" },
  { triggers:["lohmann lsl lite","lohmann_lsl_lite","lsl lite","lohmann lsl","lsl","lohmann"],
    species:"layer", label:"Layer – Lohmann LSL Lite NA",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"lohmann_lsl_lite_na", structType:"profiles_targets" },
  { triggers:["lohmann lsl ultra","lohmann_lsl_ultra","lsl ultra","lohmann lsl","lsl","lohmann"],
    species:"layer", label:"Layer – Lohmann LSL Ultra Lite",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"lohmann_lsl_ultra_lite", structType:"profiles_targets" },
  { triggers:["lohmann lsl","lohmann_lsl","lsl white","lsl layer"],
    species:"layer", label:"Layer – Lohmann LSL Classic",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"lohmann_lsl_classic", structType:"profiles_targets" },

  // Lohmann specialty variants — include "lohmann" so these score 2 vs generic's 1 for "lohmann X" queries
  { triggers:["lohmann sandy","lohmann_sandy","sandy","lohmann"],
    species:"layer", label:"Layer – Lohmann Sandy",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"lohmann_sandy", structType:"profiles_targets" },
  { triggers:["lohmann silver","lohmann_silver","silver","lohmann"],
    species:"layer", label:"Layer – Lohmann Silver",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"lohmann_silver", structType:"profiles_targets" },
  { triggers:["lohmann tradition","lohmann_tradition","tradition","lohmann"],
    species:"layer", label:"Layer – Lohmann Tradition",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"lohmann_tradition", structType:"profiles_targets" },
  { triggers:["lohmann pink","lohmann_pink","pink","lohmann"],
    species:"layer", label:"Layer – Lohmann Pink",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"lohmann_pink", structType:"profiles_targets" },

  // Hyline variants
  { triggers:["hyline brown","hy-line brown","hyline_brown","brown hyline"],
    species:"layer", label:"Layer – Hyline Brown",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"hyline_brown", structType:"profiles_targets" },
  { triggers:["hyline w80 plus","hyline w80+","hyline_w80_plus","w80 plus","w-80+","w80+"],
    species:"layer", label:"Layer – Hyline W80 Plus",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"hyline_w80_plus", structType:"profiles_targets" },
  { triggers:["hyline w80 pro","hyline_w80_pro","w80 pro","w-80 pro"],
    species:"layer", label:"Layer – Hyline W80 Pro",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"hyline_w80_pro", structType:"profiles_targets" },
  { triggers:["hyline w80","hy-line w80","hyline_w80","w-80","w80 layer"],
    species:"layer", label:"Layer – Hyline W80",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"hyline_w80", structType:"profiles_targets" },
  { triggers:["hyline pink","hy-line pink","hyline_pink","pink hyline"],
    species:"layer", label:"Layer – Hyline Pink",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"hyline_pink", structType:"profiles_targets" },
  { triggers:["hyline w36","hyline w 36","hy-line w36","hy-line w 36","hyline_w36","w36 layer","w 36 layer","w-36","w 36"],
    species:"layer", label:"Layer – Hyline W36",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"hyline_w36", structType:"profiles_targets" },
  { triggers:["hyline","hy-line"],
    species:"layer", label:"Layer – Hyline Brown",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"hyline_brown", structType:"profiles_targets" },

  // Bovans
  { triggers:["bovans white","bovans_white"],
    species:"layer", label:"Layer – Bovans White",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"bovans_white", structType:"profiles_targets" },
  { triggers:["bovans brown","bovans_brown","bovans"],
    species:"layer", label:"Layer – Bovans Brown",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"bovans_brown", structType:"profiles_targets" },

  // Generic commercial (NRC2026 white as reference standard)
  { triggers:["shaver brown","shaver_brown","novogen brown","novogen","nick chick",
              "h&n","hisex brown","hisex","tetra sl","tetra_sl","hendrix","babcock"],
    species:"layer", label:"Layer – Commercial (NRC2026 White)",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"nrc2026_white", structType:"profiles_targets" },

  { triggers:["layer","laying hen","egg hen","laying chicken","egg production","laying pullet","hen"],
    species:"layer", label:"Layer – NRC2026 White",
    file:`${CDB}/poultry/layer/v1/requirements.library.poultry.layer.v1.json`,
    breedFilter:"nrc2026_white", structType:"profiles_targets" },

  // ── Layer Breeder ─────────────────────────────────────────────────────────
  { triggers:["hyline brown f rear","hyline brown breeder","hyline brown parent"],
    species:"layer_breeder", label:"Layer Breeder – Hyline Brown",
    file:`${CDB}/poultry/layer_breeder/v1/requirements.library.poultry.layer_breeder.v1.json`,
    breedFilter:"hyline_brown_f_rear", structType:"profiles_targets" },
  { triggers:["hyline w36 f rear","hyline w36 breeder","hyline w-36 parent"],
    species:"layer_breeder", label:"Layer Breeder – Hyline W36",
    file:`${CDB}/poultry/layer_breeder/v1/requirements.library.poultry.layer_breeder.v1.json`,
    breedFilter:"hyline_w36_f_rear", structType:"profiles_targets" },
  { triggers:["hyline pink f rear","hyline pink breeder","hyline pink parent"],
    species:"layer_breeder", label:"Layer Breeder – Hyline Pink",
    file:`${CDB}/poultry/layer_breeder/v1/requirements.library.poultry.layer_breeder.v1.json`,
    breedFilter:"hyline_pink_f_rear", structType:"profiles_targets" },
  { triggers:["hyline silver brown f rear","hyline silver brown breeder","hyline silver parent"],
    species:"layer_breeder", label:"Layer Breeder – Hyline Silver Brown",
    file:`${CDB}/poultry/layer_breeder/v1/requirements.library.poultry.layer_breeder.v1.json`,
    breedFilter:"hyline_silver_brown_f_rear", structType:"profiles_targets" },
  { triggers:["lohmann lsl f rear","lohmann lsl breeder","lsl breeder","lsl parent"],
    species:"layer_breeder", label:"Layer Breeder – Lohmann LSL",
    file:`${CDB}/poultry/layer_breeder/v1/requirements.library.poultry.layer_breeder.v1.json`,
    breedFilter:"lohmann_lsl_f_rear", structType:"profiles_targets" },
  { triggers:["lohmann brown f rear","lohmann brown breeder","lohmann brown parent"],
    species:"layer_breeder", label:"Layer Breeder – Lohmann Brown",
    file:`${CDB}/poultry/layer_breeder/v1/requirements.library.poultry.layer_breeder.v1.json`,
    breedFilter:"lohmann_brown_f_rear", structType:"profiles_targets" },
  { triggers:["bovans white f rear","bovans white breeder","bovans white parent"],
    species:"layer_breeder", label:"Layer Breeder – Bovans White",
    file:`${CDB}/poultry/layer_breeder/v1/requirements.library.poultry.layer_breeder.v1.json`,
    breedFilter:"bovans_white_f_rear", structType:"profiles_targets" },
  { triggers:["bovans brown f rear","bovans brown breeder","bovans brown parent","bovans breeder"],
    species:"layer_breeder", label:"Layer Breeder – Bovans Brown",
    file:`${CDB}/poultry/layer_breeder/v1/requirements.library.poultry.layer_breeder.v1.json`,
    breedFilter:"bovans_brown_f_rear", structType:"profiles_targets" },
  { triggers:["dekalb white f rear","dekalb white breeder","dekalb white parent"],
    species:"layer_breeder", label:"Layer Breeder – Dekalb White",
    file:`${CDB}/poultry/layer_breeder/v1/requirements.library.poultry.layer_breeder.v1.json`,
    breedFilter:"dekalb_white_f_rear", structType:"profiles_targets" },
  { triggers:["dekalb brown f rear","dekalb brown breeder","dekalb brown parent","dekalb breeder"],
    species:"layer_breeder", label:"Layer Breeder – Dekalb Brown",
    file:`${CDB}/poultry/layer_breeder/v1/requirements.library.poultry.layer_breeder.v1.json`,
    breedFilter:"dekalb_brown_f_rear", structType:"profiles_targets" },
  { triggers:["layer breeder","layer parent","egg breeder","layer ps","layer parent flock"],
    species:"layer_breeder", label:"Layer Breeder – Hyline Brown",
    file:`${CDB}/poultry/layer_breeder/v1/requirements.library.poultry.layer_breeder.v1.json`,
    breedFilter:"hyline_brown_f_rear", structType:"profiles_targets" },

  // ── Turkey — Meat (Aviagen NU19 V2; all breeds identical per official guide) ─
  { triggers:["but turkey","but6","but 6","b.u.t. 6","but commercial","british united turkeys"],
    species:"turkey_meat", label:"Turkey Meat – B.U.T.6 (Aviagen NU19 V2)",
    file:`${CDB}/poultry/turkey/meat/library.poultry_turkey_meat.v1.json`,
    breedFilter:"but6", structType:"profiles_targets" },

  { triggers:["but9","but 9","b.u.t. 9"],
    species:"turkey_meat", label:"Turkey Meat – B.U.T.9 (Aviagen NU19 V2)",
    file:`${CDB}/poultry/turkey/meat/library.poultry_turkey_meat.v1.json`,
    breedFilter:"but9", structType:"profiles_targets" },

  { triggers:["aviagen turkey","aviagen_turkey","aviagen turkey grade","aviagen grade"],
    species:"turkey_meat", label:"Turkey Meat – Aviagen (NU19 V2)",
    file:`${CDB}/poultry/turkey/meat/library.poultry_turkey_meat.v1.json`,
    breedFilter:"aviagen", structType:"profiles_targets" },

  { triggers:["nicholas turkey","nicholas select","nicholas white","nicholas"],
    species:"turkey_meat", label:"Turkey Meat – Nicholas (Aviagen NU19 V2)",
    file:`${CDB}/poultry/turkey/meat/library.poultry_turkey_meat.v1.json`,
    breedFilter:"nicholas", structType:"profiles_targets" },

  { triggers:["hybrid converter","hybrid_converter","converter turkey"],
    species:"turkey_meat", label:"Turkey Meat – Hybrid Converter (Aviagen NU19 V2)",
    file:`${CDB}/poultry/turkey/meat/library.poultry_turkey_meat.v1.json`,
    breedFilter:"hybrid_converter", structType:"profiles_targets" },

  { triggers:["turkey tom","tom turkey","turkey male","male turkey","turkey meat"],
    species:"turkey_meat", label:"Turkey Meat – Generic (Aviagen NU19 V2)",
    file:`${CDB}/poultry/turkey/meat/library.poultry_turkey_meat.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  // ── Turkey — Breeder ──────────────────────────────────────────────────────
  { triggers:["nicholas turkey breeder","nicholas breeder","nicholas"],
    species:"turkey_breeder", label:"Turkey Breeder – Nicholas (Aviagen NU19 V2)",
    file:`${CDB}/poultry/turkey/breeder/library.poultry_turkey_breeder.v1.json`,
    breedFilter:"nicholas", structType:"profiles_targets" },

  { triggers:["but6 turkey breeder","but6 breeder","but 6 breeder"],
    species:"turkey_breeder", label:"Turkey Breeder – B.U.T.6 (Aviagen NU19 V2)",
    file:`${CDB}/poultry/turkey/breeder/library.poultry_turkey_breeder.v1.json`,
    breedFilter:"but6", structType:"profiles_targets" },

  { triggers:["turkey breeder","turkey parent","turkey breeder flock","breeder turkey"],
    species:"turkey_breeder", label:"Turkey Breeder – Aviagen (NU19 V2)",
    file:`${CDB}/poultry/turkey/breeder/library.poultry_turkey_breeder.v1.json`,
    breedFilter:"aviagen", structType:"profiles_targets" },

  // ── Turkey — Layer (Egg production) ──────────────────────────────────────
  { triggers:["turkey layer","turkey egg","turkey hen","turkey female","turkey laying","turkey egg production"],
    species:"turkey_layer", label:"Turkey Layer – Aviagen (NU19 V2)",
    file:`${CDB}/poultry/turkey/layer/library.poultry_turkey_layer.v1.json`,
    breedFilter:"aviagen", structType:"profiles_targets" },

  { triggers:["nicholas turkey layer","nicholas turkey egg","nicholas layer"],
    species:"turkey_layer", label:"Turkey Layer – Nicholas (Aviagen NU19 V2)",
    file:`${CDB}/poultry/turkey/layer/library.poultry_turkey_layer.v1.json`,
    breedFilter:"nicholas", structType:"profiles_targets" },

  { triggers:["turkey"],
    species:"turkey_meat", label:"Turkey – Generic (Aviagen NU19 V2)",
    file:`${CDB}/poultry/turkey/meat/library.poultry_turkey_meat.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  // ── Duck — Meat (NRC 2026 Pekin; all breeds identical per official source) ─
  { triggers:["pekin duck","beijing duck","white pekin","pekin"],
    species:"duck_meat", label:"Duck Meat – Pekin (NRC 2026)",
    file:`${CDB}/poultry/duck/meat/library.poultry_duck_meat.v1.json`,
    breedFilter:"pekin", structType:"profiles_targets" },

  { triggers:["cherry valley duck","cherry valley","cherry_valley"],
    species:"duck_meat", label:"Duck Meat – Cherry Valley (NRC 2026)",
    file:`${CDB}/poultry/duck/meat/library.poultry_duck_meat.v1.json`,
    breedFilter:"cherry_valley", structType:"profiles_targets" },

  { triggers:["mulard duck","muleard duck","mule duck","mulard"],
    species:"duck_meat", label:"Duck Meat – Mulard (NRC 2026)",
    file:`${CDB}/poultry/duck/meat/library.poultry_duck_meat.v1.json`,
    breedFilter:"mulard", structType:"profiles_targets" },

  { triggers:["muscovy duck","muscovy","barbary duck"],
    species:"duck_meat", label:"Duck Meat – Muscovy (NRC 2026)",
    file:`${CDB}/poultry/duck/meat/library.poultry_duck_meat.v1.json`,
    breedFilter:"muscovy", structType:"profiles_targets" },

  { triggers:["grimaud duck","grimaud","grimaud freres"],
    species:"duck_meat", label:"Duck Meat – Grimaud (NRC 2026)",
    file:`${CDB}/poultry/duck/meat/library.poultry_duck_meat.v1.json`,
    breedFilter:"grimaud", structType:"profiles_targets" },

  { triggers:["duck meat","meat duck","roaster duck"],
    species:"duck_meat", label:"Duck Meat – Generic (NRC 2026)",
    file:`${CDB}/poultry/duck/meat/library.poultry_duck_meat.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  // ── Duck — Breeder (Orvia CKM Pekin; all breeds identical) ───────────────
  { triggers:["pekin duck breeder","pekin breeder duck","pekin"],
    species:"duck_breeder", label:"Duck Breeder – Pekin (Orvia CKM)",
    file:`${CDB}/poultry/duck/breeder/library.poultry_duck_breeder.v1.json`,
    breedFilter:"pekin", structType:"profiles_targets" },

  { triggers:["muscovy duck breeder","muscovy breeder"],
    species:"duck_breeder", label:"Duck Breeder – Muscovy (Orvia CKM basis)",
    file:`${CDB}/poultry/duck/breeder/library.poultry_duck_breeder.v1.json`,
    breedFilter:"muscovy", structType:"profiles_targets" },

  { triggers:["duck breeder","breeder duck","duck parent flock","duck parent"],
    species:"duck_breeder", label:"Duck Breeder – Generic (Orvia CKM Pekin)",
    file:`${CDB}/poultry/duck/breeder/library.poultry_duck_breeder.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  // ── Duck — Layer (NRC 2026) ───────────────────────────────────────────────
  { triggers:["pekin duck layer","pekin layer","pekin duck egg","pekin"],
    species:"duck_layer", label:"Duck Layer – Pekin (NRC 2026)",
    file:`${CDB}/poultry/duck/layer/library.poultry_duck_layer.v1.json`,
    breedFilter:"pekin", structType:"profiles_targets" },

  { triggers:["duck layer","laying duck","egg duck","khaki campbell","indian runner"],
    species:"duck_layer", label:"Duck Layer – Generic (NRC 2026)",
    file:`${CDB}/poultry/duck/layer/library.poultry_duck_layer.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  { triggers:["duck"],
    species:"duck_meat", label:"Duck – Generic (NRC 2026)",
    file:`${CDB}/poultry/duck/meat/library.poultry_duck_meat.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  // ── Quail — Meat (NRC 2026; meat-type vs egg-type differentiated) ─────────
  { triggers:["japanese meat quail","quail meat type","japanese_meat quail"],
    species:"quail_meat", label:"Quail Meat – Japanese Meat-Type (NRC 2026)",
    file:`${CDB}/poultry/quail/meat/library.poultry_quail_meat.v1.json`,
    breedFilter:"japanese_meat", structType:"profiles_targets" },

  { triggers:["coturnix quail","coturnix japonica","quail meat"],
    species:"quail_meat", label:"Quail Meat – Coturnix (NRC 2026)",
    file:`${CDB}/poultry/quail/meat/library.poultry_quail_meat.v1.json`,
    breedFilter:"coturnix", structType:"profiles_targets" },

  // ── Quail — Layer (NRC 2026 egg-type) ────────────────────────────────────
  { triggers:["japanese quail","japanese layer quail","quail layer","quail egg","coturnix layer","japanese quail layer"],
    species:"quail_layer", label:"Quail Layer – Japanese Layer-Type (NRC 2026)",
    file:`${CDB}/poultry/quail/layer/library.poultry_quail_layer.v1.json`,
    breedFilter:"japanese_layer", structType:"profiles_targets" },

  // ── Quail — Breeder ───────────────────────────────────────────────────────
  { triggers:["quail breeder","quail parent"],
    species:"quail_breeder", label:"Quail Breeder – Generic (NRC 2026)",
    file:`${CDB}/poultry/quail/breeder/library.poultry_quail_breeder.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  { triggers:["quail","coturnix","bobwhite quail"],
    species:"quail_meat", label:"Quail – Generic (NRC 2026)",
    file:`${CDB}/poultry/quail/meat/library.poultry_quail_meat.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  // ── Goose — Meat (NRC 2026; all breeds identical) ────────────────────────
  { triggers:["embden goose","embden"],
    species:"goose_meat", label:"Goose Meat – Embden (NRC 2026)",
    file:`${CDB}/poultry/goose/meat/library.poultry_goose_meat.v1.json`,
    breedFilter:"embden", structType:"profiles_targets" },

  { triggers:["toulouse goose","toulouse"],
    species:"goose_meat", label:"Goose Meat – Toulouse (NRC 2026)",
    file:`${CDB}/poultry/goose/meat/library.poultry_goose_meat.v1.json`,
    breedFilter:"toulouse", structType:"profiles_targets" },

  { triggers:["african goose","chinese goose"],
    species:"goose_meat", label:"Goose Meat – African (NRC 2026)",
    file:`${CDB}/poultry/goose/meat/library.poultry_goose_meat.v1.json`,
    breedFilter:"african", structType:"profiles_targets" },

  { triggers:["goose meat","meat goose","roaster goose"],
    species:"goose_meat", label:"Goose Meat – Generic (NRC 2026)",
    file:`${CDB}/poultry/goose/meat/library.poultry_goose_meat.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  // ── Goose — Breeder (NRC 2026) ────────────────────────────────────────────
  { triggers:["embden goose breeder","embden breeder"],
    species:"goose_breeder", label:"Goose Breeder – Embden (NRC 2026)",
    file:`${CDB}/poultry/goose/breeder/library.poultry_goose_breeder.v1.json`,
    breedFilter:"embden", structType:"profiles_targets" },

  { triggers:["toulouse goose breeder","toulouse breeder"],
    species:"goose_breeder", label:"Goose Breeder – Toulouse (NRC 2026)",
    file:`${CDB}/poultry/goose/breeder/library.poultry_goose_breeder.v1.json`,
    breedFilter:"toulouse", structType:"profiles_targets" },

  { triggers:["goose breeder","breeder goose","goose parent"],
    species:"goose_breeder", label:"Goose Breeder – Generic (NRC 2026)",
    file:`${CDB}/poultry/goose/breeder/library.poultry_goose_breeder.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  // ── Goose — Layer (NRC 2026) ──────────────────────────────────────────────
  { triggers:["african goose layer","african goose egg"],
    species:"goose_layer", label:"Goose Layer – African (NRC 2026)",
    file:`${CDB}/poultry/goose/layer/library.poultry_goose_layer.v1.json`,
    breedFilter:"african", structType:"profiles_targets" },

  { triggers:["embden goose layer","embden layer"],
    species:"goose_layer", label:"Goose Layer – Embden (NRC 2026)",
    file:`${CDB}/poultry/goose/layer/library.poultry_goose_layer.v1.json`,
    breedFilter:"embden", structType:"profiles_targets" },

  { triggers:["goose layer","laying goose","goose egg"],
    species:"goose_layer", label:"Goose Layer – Generic (NRC 2026)",
    file:`${CDB}/poultry/goose/layer/library.poultry_goose_layer.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  { triggers:["goose"],
    species:"goose_meat", label:"Goose – Generic (NRC 2026)",
    file:`${CDB}/poultry/goose/meat/library.poultry_goose_meat.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  // ── Pheasant (NRC 2026) ───────────────────────────────────────────────────
  { triggers:["ring-necked pheasant","ring necked pheasant","ringneck pheasant","ringneck"],
    species:"pheasant_meat", label:"Pheasant Meat – Ring-Necked (NRC 2026)",
    file:`${CDB}/poultry/pheasant/meat/library.poultry_pheasant_meat.v1.json`,
    breedFilter:"ring_necked", structType:"profiles_targets" },

  { triggers:["melanistic pheasant","melanistic"],
    species:"pheasant_meat", label:"Pheasant Meat – Melanistic (NRC 2026)",
    file:`${CDB}/poultry/pheasant/meat/library.poultry_pheasant_meat.v1.json`,
    breedFilter:"melanistic", structType:"profiles_targets" },

  { triggers:["pheasant breeder","pheasant parent"],
    species:"pheasant_breeder", label:"Pheasant Breeder – Generic (NRC 2026)",
    file:`${CDB}/poultry/pheasant/breeder/library.poultry_pheasant_breeder.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  { triggers:["pheasant"],
    species:"pheasant_meat", label:"Pheasant – Generic (NRC 2026)",
    file:`${CDB}/poultry/pheasant/meat/library.poultry_pheasant_meat.v1.json`,
    breedFilter:"generic", structType:"profiles_targets" },

  // ── Swine / Pig ───────────────────────────────────────────────────────────
  // Note: Danbred, Topigs TN70, PIC337 performance curves exist but are production libraries.
  // Nutrient requirement formulation is in the v1 swine phases library.
  { triggers:["danbred","danbred pig","danbred sow"],
    species:"swine", label:"Swine – Danbred",
    file:`${CDB}/swine/v1/requirements.library.swine.v1.json`,
    breedFilter:null, structType:"swine_phases" },

  { triggers:["topigs","topigs tn70","tn70","topigs pig"],
    species:"swine", label:"Swine – Topigs TN70",
    file:`${CDB}/swine/v1/requirements.library.swine.v1.json`,
    breedFilter:null, structType:"swine_phases" },

  { triggers:["pic 337","pic337","pic pig","pic swine"],
    species:"swine", label:"Swine – PIC 337",
    file:`${CDB}/swine/v1/requirements.library.swine.v1.json`,
    breedFilter:null, structType:"swine_phases" },

  { triggers:[
      "swine","pig","pork","hog","sow","piglet","boar","gilt","farrow",
      "grower pig","nursery pig","weaner pig","feeder pig","market pig","finishing pig",
      // Common commercial maternal breeds (Yorkshire, Landrace, Meishan) → standard swine reqs
      "yorkshire pig","yorkshire hog","large white pig","landrace pig","landrace hog",
      "yorkshire landrace","landrace yorkshire","yl cross","ly cross",
      "meishan","chinese pig","meishan pig",
      // Terminal sires (Duroc, Hampshire, Pietrain, Berkshire)
      "duroc","duroc pig","pietrain","pietrain pig","hampshire pig","hampshire hog",
      "berkshire","berkshire pig","berkshire pork","black pig","heritage pig",
      // Generic / crossbred
      "crossbred pig","commercial pig","hybrid pig","f1 pig","yorkshire duroc",
      "spotted pig","poland china","chester white","tamworth","gloucestershire old spot",
      "mangalitza","mangalitsa","iberian pig","iberico",
    ],
    species:"swine", label:"Swine (NRC/PIC Reference)",
    file:`${CDB}/swine/v1/requirements.library.swine.v1.json`,
    breedFilter:null, structType:"swine_phases" },

  // ── Equine — all breeds share NRC 2007 equations; breed differences are body-weight driven ──
  // Breeding / reproduction entries (get +3 production boost when "breeder"/"stallion"/"mare" in query)
  { triggers:["stallion","breeding stallion","stud horse","breeding horse","stud"],
    species:"equine", label:"Breeding Stallion (NRC 2007)",
    file:`${CDB}/equine/horse/library.equine_horse_profiles.v1.json`,
    breedFilter:"equine_horse_breeding_stallion_v1", structType:"profiles_targets" },

  { triggers:["pregnant mare","gestation","late gestation","early gestation","mare gestation"],
    species:"equine", label:"Pregnant Mare (NRC 2007)",
    file:`${CDB}/equine/horse/library.equine_horse_profiles.v1.json`,
    breedFilter:"equine_horse_late_gestation_v1", structType:"profiles_targets" },

  { triggers:["lactating mare","lactation","nursing mare","foaling mare","milk mare","mare milk"],
    species:"equine", label:"Lactating Mare (NRC 2007)",
    file:`${CDB}/equine/horse/library.equine_horse_profiles.v1.json`,
    breedFilter:"equine_horse_peak_lactation_v1", structType:"profiles_targets" },

  // Breed-specific entries (all use same NRC 2007 % DM targets; note BW difference in label)
  { triggers:["thoroughbred","thoroughbred horse","tb horse"],
    species:"equine", label:"Thoroughbred – Horse (NRC 2007, ~500 kg)",
    file:`${CDB}/equine/horse/library.equine_horse_profiles.v1.json`,
    breedFilter:null, structType:"profiles_targets" },

  { triggers:["warmblood","kwpn","hanoverian","oldenburg","dutch warmblood","sport horse"],
    species:"equine", label:"Warmblood – Horse (NRC 2007, ~600 kg)",
    file:`${CDB}/equine/horse/library.equine_horse_profiles.v1.json`,
    breedFilter:null, structType:"profiles_targets" },

  { triggers:["quarter horse","american quarter horse","qh"],
    species:"equine", label:"Quarter Horse (NRC 2007, ~500 kg)",
    file:`${CDB}/equine/horse/library.equine_horse_profiles.v1.json`,
    breedFilter:null, structType:"profiles_targets" },

  { triggers:["arabian","arab horse","arabian horse"],
    species:"equine", label:"Arabian Horse (NRC 2007, ~450 kg)",
    file:`${CDB}/equine/horse/library.equine_horse_profiles.v1.json`,
    breedFilter:null, structType:"profiles_targets" },

  { triggers:["friesian","friesian horse","frisian"],
    species:"equine", label:"Friesian Horse (NRC 2007, ~600 kg)",
    file:`${CDB}/equine/horse/library.equine_horse_profiles.v1.json`,
    breedFilter:null, structType:"profiles_targets" },

  { triggers:["draft horse","clydesdale","percheron","shire horse","shire","belgian draft","draught horse"],
    species:"equine", label:"Draft Horse (NRC 2007, ~750–900 kg)",
    file:`${CDB}/equine/horse/library.equine_horse_profiles.v1.json`,
    breedFilter:null, structType:"profiles_targets" },

  { triggers:["pony","shetland","welsh pony","connemara","dartmoor","new forest pony"],
    species:"equine", label:"Pony (NRC 2007, ~250–350 kg)",
    file:`${CDB}/equine/horse/library.equine_horse_profiles.v1.json`,
    breedFilter:null, structType:"profiles_targets" },

  { triggers:["horse","equine","foal","mare","weanling","yearling","gelding","appaloosa","andalusian","mustang","morgan","standardbred","paint horse","palomino"],
    species:"equine", label:"Horse – Generic (NRC 2007)",
    file:`${CDB}/equine/horse/library.equine_horse_profiles.v1.json`,
    breedFilter:null, structType:"profiles_targets" },

  // ── Donkey ───────────────────────────────────────────────────────────────
  { triggers:["dezhou wutou","wutou donkey"],
    species:"donkey", label:"Donkey – Dezhou Wutou",
    file:`${CDB}/equine/donkey/performance.library.donkey.v2025.json`,
    breedFilter:"dezhou_wutou", structType:"performance_library" },
  { triggers:["dezhou sanfen","sanfen donkey"],
    species:"donkey", label:"Donkey – Dezhou Sanfen",
    file:`${CDB}/equine/donkey/performance.library.donkey.v2025.json`,
    breedFilter:"dezhou_sanfen", structType:"performance_library" },
  { triggers:["guanzhong donkey","guanzhong"],
    species:"donkey", label:"Donkey – Guanzhong",
    file:`${CDB}/equine/donkey/performance.library.donkey.v2025.json`,
    breedFilter:"guanzhong", structType:"performance_library" },
  { triggers:["jinnan donkey","jinnan"],
    species:"donkey", label:"Donkey – Jinnan",
    file:`${CDB}/equine/donkey/performance.library.donkey.v2025.json`,
    breedFilter:"jinnan", structType:"performance_library" },
  { triggers:["poitou donkey","poitou"],
    species:"donkey", label:"Donkey – Poitou",
    file:`${CDB}/equine/donkey/performance.library.donkey.v2025.json`,
    breedFilter:"poitou", structType:"performance_library" },
  { triggers:["mammoth jackstock","mammoth donkey","american mammoth"],
    species:"donkey", label:"Donkey – Mammoth Jackstock",
    file:`${CDB}/equine/donkey/performance.library.donkey.v2025.json`,
    breedFilter:"mammoth_jackstock", structType:"performance_library" },
  { triggers:["nubian donkey","nubian ass"],
    species:"donkey", label:"Donkey – Nubian",
    file:`${CDB}/equine/donkey/performance.library.donkey.v2025.json`,
    breedFilter:"nubian", structType:"performance_library" },
  { triggers:["somali donkey","somali ass"],
    species:"donkey", label:"Donkey – Somali",
    file:`${CDB}/equine/donkey/performance.library.donkey.v2025.json`,
    breedFilter:"somali", structType:"performance_library" },
  { triggers:["baluchi donkey","baluchi ass"],
    species:"donkey", label:"Donkey – Baluchi",
    file:`${CDB}/equine/donkey/performance.library.donkey.v2025.json`,
    breedFilter:"baluchi_donkey", structType:"performance_library" },
  { triggers:["kathiawari donkey","kathiawari"],
    species:"donkey", label:"Donkey – Kathiawari",
    file:`${CDB}/equine/donkey/performance.library.donkey.v2025.json`,
    breedFilter:"kathiawari_donkey", structType:"performance_library" },
  { triggers:["moroccan donkey","morocco donkey"],
    species:"donkey", label:"Donkey – Moroccan",
    file:`${CDB}/equine/donkey/performance.library.donkey.v2025.json`,
    breedFilter:"moroccan_donkey", structType:"performance_library" },
  { triggers:["miniature donkey","miniature ass"],
    species:"donkey", label:"Donkey – Miniature",
    file:`${CDB}/equine/donkey/performance.library.donkey.v2025.json`,
    breedFilter:"miniature_donkey", structType:"performance_library" },
  { triggers:["donkey","ass","burro","jack","jenny","jackass"],
    species:"donkey", label:"Donkey – Standard",
    file:`${CDB}/equine/donkey/performance.library.donkey.v2025.json`,
    breedFilter:"standard_donkey", structType:"performance_library" },

  // ── Mule ─────────────────────────────────────────────────────────────────
  { triggers:["draft mule","heavy mule","work mule","pulling mule"],
    species:"mule", label:"Mule – Draft",
    file:`${CDB}/equine/mule/performance.library.mule.v2025.json`,
    breedFilter:"draft_mule", structType:"performance_library" },
  { triggers:["pack mule","trail mule","mountain mule"],
    species:"mule", label:"Mule – Pack",
    file:`${CDB}/equine/mule/performance.library.mule.v2025.json`,
    breedFilter:"pack_mule", structType:"performance_library" },
  { triggers:["saddle mule","riding mule","gaited mule"],
    species:"mule", label:"Mule – Saddle",
    file:`${CDB}/equine/mule/performance.library.mule.v2025.json`,
    breedFilter:"saddle_mule", structType:"performance_library" },
  { triggers:["farm mule","field mule"],
    species:"mule", label:"Mule – Farm",
    file:`${CDB}/equine/mule/performance.library.mule.v2025.json`,
    breedFilter:"farm_mule", structType:"performance_library" },
  { triggers:["miniature mule"],
    species:"mule", label:"Mule – Miniature",
    file:`${CDB}/equine/mule/performance.library.mule.v2025.json`,
    breedFilter:"miniature_mule", structType:"performance_library" },
  { triggers:["hinny"],
    species:"mule", label:"Hinny",
    file:`${CDB}/equine/mule/performance.library.mule.v2025.json`,
    breedFilter:"hinny", structType:"performance_library" },
  { triggers:["mule"],
    species:"mule", label:"Mule – Farm",
    file:`${CDB}/equine/mule/performance.library.mule.v2025.json`,
    breedFilter:"farm_mule", structType:"performance_library" },

  // ── Dairy ─────────────────────────────────────────────────────────────────
  { triggers:["holstein","holstein cow","friesian","black and white cow","holsteinfriesian"],
    species:"dairy", label:"Dairy – Holstein",
    file:`${CDB}/dairy/holstein/global/performance.holstein.global.v2025.json`,
    breedFilter:null, structType:"performance_library" },
  { triggers:["jersey","jersey cow","jersey dairy"],
    species:"dairy", label:"Dairy – Jersey",
    file:`${CDB}/dairy/jersey/global/performance.jersey.global.v2025.json`,
    breedFilter:null, structType:"performance_library" },
  { triggers:["brown swiss","brown swiss cow"],
    species:"dairy", label:"Dairy – Brown Swiss",
    file:`${CDB}/performance.library.dairy.v2025.json`,
    breedFilter:"dairy_cow/brown_swiss", structType:"performance_library" },
  { triggers:["ayrshire","ayrshire cow"],
    species:"dairy", label:"Dairy – Ayrshire",
    file:`${CDB}/performance.library.dairy.v2025.json`,
    breedFilter:"dairy_cow/ayrshire", structType:"performance_library" },
  { triggers:["guernsey","guernsey cow"],
    species:"dairy", label:"Dairy – Guernsey",
    file:`${CDB}/performance.library.dairy.v2025.json`,
    breedFilter:"dairy_cow/guernsey", structType:"performance_library" },
  { triggers:["milking shorthorn","dairy shorthorn"],
    species:"dairy", label:"Dairy – Milking Shorthorn",
    file:`${CDB}/performance.library.dairy.v2025.json`,
    breedFilter:"dairy_cow/milking_shorthorn", structType:"performance_library" },
  { triggers:["sahiwal","sahiwal cow"],
    species:"dairy", label:"Dairy – Sahiwal",
    file:`${CDB}/performance.library.dairy.v2025.json`,
    breedFilter:"dairy_cow/sahiwal", structType:"performance_library" },
  { triggers:["gir cow","gir dairy","gir cattle"],
    species:"dairy", label:"Dairy – Gir",
    file:`${CDB}/performance.library.dairy.v2025.json`,
    breedFilter:"dairy_cow/gir", structType:"performance_library" },
  { triggers:["murrah buffalo","murrah"],
    species:"dairy", label:"Dairy – Murrah Buffalo",
    file:`${CDB}/performance.library.dairy.v2025.json`,
    breedFilter:"dairy_buffalo/murrah_buffalo", structType:"performance_library" },
  { triggers:["nili ravi","nili-ravi","nili ravi buffalo"],
    species:"dairy", label:"Dairy – Nili-Ravi Buffalo",
    file:`${CDB}/performance.library.dairy.v2025.json`,
    breedFilter:"dairy_buffalo/nili_ravi_buffalo", structType:"performance_library" },
  { triggers:["dairy buffalo","buffalo dairy","water buffalo"],
    species:"dairy", label:"Dairy – Buffalo",
    file:`${CDB}/performance.library.dairy.v2025.json`,
    breedFilter:"dairy_buffalo/murrah_buffalo", structType:"performance_library" },
  { triggers:["dairy cow","milking cow","lactating cow","dairy cattle","dairy"],
    species:"dairy", label:"Dairy – Holstein",
    file:`${CDB}/dairy/holstein/global/performance.holstein.global.v2025.json`,
    breedFilter:null, structType:"performance_library" },

  // ── Beef ─────────────────────────────────────────────────────────────────
  { triggers:["angus","black angus","red angus","aberdeen angus","angus cross","brangus","santa gertrudis","murray grey","belted galloway","galloway","highland cattle","highland cow","dexter cattle","dexter cow"],
    species:"beef", label:"Beef – Angus",
    file:`${CDB}/performance.library.beef.v2025.json`,
    breedFilter:"beef_cow/angus", structType:"performance_library" },
  { triggers:["hereford","hereford cattle","hereford cow","polled hereford","beefmaster","droughtmaster"],
    species:"beef", label:"Beef – Hereford",
    file:`${CDB}/performance.library.beef.v2025.json`,
    breedFilter:"beef_cow/hereford", structType:"performance_library" },
  { triggers:["simmental","simmental cattle","fleckvieh beef","simbrah"],
    species:"beef", label:"Beef – Simmental",
    file:`${CDB}/performance.library.beef.v2025.json`,
    breedFilter:"beef_cow/simmental", structType:"performance_library" },
  { triggers:["charolais","charolais cattle","blonde d aquitaine","blonde daquitaine","chianina","piemontese","belgian blue","double muscled"],
    species:"beef", label:"Beef – Charolais",
    file:`${CDB}/performance.library.beef.v2025.json`,
    breedFilter:"beef_cow/charolais", structType:"performance_library" },
  { triggers:["brahman","brahman cattle","zebu","gyr beef","gir beef","indu brazil","indubrasil","tuli","baggara","afrikaner"],
    species:"beef", label:"Beef – Brahman",
    file:`${CDB}/performance.library.beef.v2025.json`,
    breedFilter:"beef_cow/brahman", structType:"performance_library" },
  { triggers:["nelore","nellore","nelore cattle","tabapua","guzera","guzerat beef"],
    species:"beef", label:"Beef – Nelore",
    file:`${CDB}/performance.library.beef.v2025.json`,
    breedFilter:"beef_cow/nelore", structType:"performance_library" },
  { triggers:["wagyu","wagyu beef","japanese beef","kobe beef","tajima","omi beef","mishima","akaushi","japanese black","japanese brown","japanese shorthorn"],
    species:"beef", label:"Beef – Wagyu",
    file:`${CDB}/performance.library.beef.v2025.json`,
    breedFilter:"beef_cow/wagyu", structType:"performance_library" },
  { triggers:["limousin","limousin cattle","lim","lim flex"],
    species:"beef", label:"Beef – Limousin",
    file:`${CDB}/performance.library.beef.v2025.json`,
    breedFilter:"beef_cow/limousin", structType:"performance_library" },
  { triggers:["shorthorn beef","beef shorthorn","shorthorn cattle","milking shorthorn beef"],
    species:"beef", label:"Beef – Shorthorn",
    file:`${CDB}/performance.library.beef.v2025.json`,
    breedFilter:"beef_cow/shorthorn_beef", structType:"performance_library" },
  { triggers:["beef cattle","beef cow","beef steer","beef heifer","feedlot cattle","stocker","beef","backgrounding cattle","crossbred beef"],
    species:"beef", label:"Beef – Angus",
    file:`${CDB}/performance.library.beef.v2025.json`,
    breedFilter:"beef_cow/angus", structType:"performance_library" },

  // ── Sheep ─────────────────────────────────────────────────────────────────
  // Wool/fine-wool breeds → Merino
  { triggers:["merino","merino sheep","merino wool","rambouillet","corriedale","polwarth","booroola","poll merino","delaine merino"],
    species:"sheep", label:"Sheep – Merino",
    file:`${CDB}/sheep/performance.library.sheep.v2025.json`,
    breedFilter:"sheep_meat/merino", structType:"performance_library" },
  // Heavy muscled terminal sire breeds → Suffolk
  { triggers:["suffolk","suffolk sheep","suffolk lamb","hampshire sheep","hampshire lamb","shropshire","oxford down","southdown"],
    species:"sheep", label:"Sheep – Suffolk",
    file:`${CDB}/sheep/performance.library.sheep.v2025.json`,
    breedFilter:"sheep_meat/suffolk", structType:"performance_library" },
  // Muscled Continental breeds → Texel
  { triggers:["texel","texel sheep","ile de france","charollais sheep","berrichon","vendeen","beltex"],
    species:"sheep", label:"Sheep – Texel",
    file:`${CDB}/sheep/performance.library.sheep.v2025.json`,
    breedFilter:"sheep_meat/texel", structType:"performance_library" },
  // Hair sheep & tropical breeds → Dorper
  { triggers:["dorper","dorper sheep","white dorper","katahdin","barbados blackbelly","pelibuey","st croix sheep","romanov","hair sheep","morada nova"],
    species:"sheep", label:"Sheep – Dorper",
    file:`${CDB}/sheep/performance.library.sheep.v2025.json`,
    breedFilter:"sheep_meat/dorper", structType:"performance_library" },
  // Dual-purpose Middle-East/Asian → Awassi
  { triggers:["awassi","awassi sheep","assaf","assaf sheep","fat tail sheep","fattail","fat-tailed","karakul"],
    species:"sheep", label:"Sheep – Awassi",
    file:`${CDB}/sheep/performance.library.sheep.v2025.json`,
    breedFilter:"sheep_meat/awassi", structType:"performance_library" },
  // South Asian breeds → Kajli
  { triggers:["kajli","kajli sheep","kail sheep","pak sheep","saltrange sheep"],
    species:"sheep", label:"Sheep – Kajli",
    file:`${CDB}/sheep/performance.library.sheep.v2025.json`,
    breedFilter:"sheep_meat/kajli", structType:"performance_library" },
  { triggers:["nali sheep","nali","chokla","malpura","marwari sheep","jaisalmeri"],
    species:"sheep", label:"Sheep – Nali",
    file:`${CDB}/sheep/performance.library.sheep.v2025.json`,
    breedFilter:"sheep_meat/nali", structType:"performance_library" },
  // Dairy sheep → Lacaune
  { triggers:["lacaune","lacaune sheep","lacaune dairy","east friesian","east friesian sheep","british friesian sheep","ostfriesisches milchschaf"],
    species:"sheep", label:"Sheep – Lacaune (Dairy)",
    file:`${CDB}/sheep/performance.library.sheep.v2025.json`,
    breedFilter:"sheep_dairy/lacaune", structType:"performance_library" },
  { triggers:["awassi dairy","dairy awassi","milk awassi","improved awassi"],
    species:"sheep", label:"Sheep – Awassi Dairy",
    file:`${CDB}/sheep/performance.library.sheep.v2025.json`,
    breedFilter:"sheep_dairy/awassi_dairy", structType:"performance_library" },
  // Generic sheep catch-all → Merino
  { triggers:["sheep","ewe","ram","lamb","wether","hogget","dorset","romney","targhee","columbia sheep","polypay","finn sheep","finnsh"],
    species:"sheep", label:"Sheep – Merino",
    file:`${CDB}/sheep/performance.library.sheep.v2025.json`,
    breedFilter:"sheep_meat/merino", structType:"performance_library" },

  // ── Goat ─────────────────────────────────────────────────────────────────
  { triggers:["boer goat","boer"],
    species:"goat", label:"Goat – Boer (Meat)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_meat/boer", structType:"performance_library" },
  { triggers:["kiko goat","kiko"],
    species:"goat", label:"Goat – Kiko (Meat)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_meat/kiko", structType:"performance_library" },
  { triggers:["kalahari red","kalahari goat"],
    species:"goat", label:"Goat – Kalahari Red (Meat)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_meat/kalahari_red", structType:"performance_library" },
  { triggers:["savanna goat","savanna"],
    species:"goat", label:"Goat – Savanna (Meat)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_meat/savanna", structType:"performance_library" },
  { triggers:["myotonic","fainting goat","tennessee fainting"],
    species:"goat", label:"Goat – Myotonic (Meat)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_meat/myotonic", structType:"performance_library" },
  { triggers:["black bengal","black bengal goat"],
    species:"goat", label:"Goat – Black Bengal (Meat)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_meat/black_bengal", structType:"performance_library" },
  { triggers:["spanish goat","meat goat spanish"],
    species:"goat", label:"Goat – Spanish (Meat)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_meat/spanish", structType:"performance_library" },
  { triggers:["saanen","saanen goat","dairy goat saanen"],
    species:"goat", label:"Goat – Saanen (Dairy)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_dairy/saanen", structType:"performance_library" },
  { triggers:["alpine goat","french alpine","alpine dairy"],
    species:"goat", label:"Goat – Alpine (Dairy)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_dairy/alpine", structType:"performance_library" },
  { triggers:["nubian goat","anglo nubian","nubian dairy"],
    species:"goat", label:"Goat – Nubian (Dairy)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_dairy/nubian", structType:"performance_library" },
  { triggers:["toggenburg","toggenburg goat","toggenburg dairy"],
    species:"goat", label:"Goat – Toggenburg (Dairy)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_dairy/toggenburg", structType:"performance_library" },
  { triggers:["lamancha","lamancha goat","lamancha dairy"],
    species:"goat", label:"Goat – LaMancha (Dairy)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_dairy/lamancha", structType:"performance_library" },
  { triggers:["oberhasli","oberhasli goat","oberhasli dairy"],
    species:"goat", label:"Goat – Oberhasli (Dairy)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_dairy/oberhasli", structType:"performance_library" },
  { triggers:["beetal","beetal dairy goat"],
    species:"goat", label:"Goat – Beetal (Dairy)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_dairy/beetal_dairy", structType:"performance_library" },
  { triggers:["beetal goat","beetal dual"],
    species:"goat", label:"Goat – Beetal (Dual)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_dual/beetal", structType:"performance_library" },
  { triggers:["barbari","barbari goat"],
    species:"goat", label:"Goat – Barbari (Dual)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_dual/barbari", structType:"performance_library" },
  { triggers:["angora goat","angora","mohair goat"],
    species:"goat", label:"Goat – Angora (Fiber)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_fiber/angora", structType:"performance_library" },
  { triggers:["cashmere goat","cashmere","kashmir goat"],
    species:"goat", label:"Goat – Cashmere (Fiber)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_fiber/cashmere", structType:"performance_library" },
  { triggers:["osmanabadi","osmanabadi goat"],
    species:"goat", label:"Goat – Osmanabadi",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_meat/black_bengal", structType:"performance_library" },
  // Dairy goat breeds not yet individually listed → Saanen fallback
  { triggers:["nigerian dwarf","nigerian dwarf goat","miniature goat","dwarf goat","pygmy goat","pygmy"],
    species:"goat", label:"Goat – Saanen (Dairy)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_dairy/saanen", structType:"performance_library" },
  { triggers:["sirohi","sirohi goat","jamnapari","jamunapari","malabari","tellicherry","beetal cross"],
    species:"goat", label:"Goat – Beetal (Dual)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_dual/beetal", structType:"performance_library" },
  // Generic goat catch-all → Boer (most common meat goat globally)
  { triggers:["goat","doe","buck goat","kid goat","dairy goat","meat goat","caprine","nanny goat","billy goat","wether goat","doeling","buckling"],
    species:"goat", label:"Goat – Boer (Meat)",
    file:`${CDB}/goat/performance.library.goat.v2025.json`,
    breedFilter:"goat_meat/boer", structType:"performance_library" },

  // ── Aquaculture ───────────────────────────────────────────────────────────
  { triggers:["atlantic salmon","pacific salmon","salmon","coho","chinook"],
    species:"salmon", label:"Atlantic Salmon (NRC 2011 + Norwegian industry 2022)",
    file:`${CDB}/aquaculture/performance.library.aquaculture.v2025.json`,
    breedFilter:"aquaculture/atlantic_salmon", structType:"performance_library" },

  { triggers:["rainbow trout","brown trout","brook trout","trout"],
    species:"trout", label:"Trout (NRC 2011)",
    file:`${CDB}/aquaculture/performance.library.aquaculture.v2025.json`,
    breedFilter:"aquaculture/atlantic_salmon", structType:"performance_library" },

  { triggers:["tilapia","nile tilapia","gift tilapia","red tilapia","o. niloticus"],
    species:"tilapia", label:"Nile Tilapia GIFT (NRC 2011 + WorldFish 2021)",
    file:`${CDB}/aquaculture/performance.library.aquaculture.v2025.json`,
    breedFilter:"aquaculture/nile_tilapia_gift", structType:"performance_library" },

  { triggers:["channel catfish","african catfish","clarias catfish","catfish"],
    species:"catfish", label:"Channel Catfish (NRC 2011 + USDA NASS 2022)",
    file:`${CDB}/aquaculture/performance.library.aquaculture.v2025.json`,
    breedFilter:"aquaculture/channel_catfish", structType:"performance_library" },

  { triggers:["common carp","grass carp","silver carp","bighead carp","carp"],
    species:"carp", label:"Common Carp (NRC 2011 + FAO)",
    file:`${CDB}/aquaculture/performance.library.aquaculture.v2025.json`,
    breedFilter:"aquaculture/common_carp", structType:"performance_library" },

  { triggers:["european seabass","asian seabass","barramundi","seabass","sea bass","branzino","loup de mer"],
    species:"seabass", label:"European Seabass (EUMOFA 2023 + FAO MedAqua)",
    file:`${CDB}/aquaculture/performance.library.aquaculture.v2025.json`,
    breedFilter:"aquaculture/european_seabass", structType:"performance_library" },

  { triggers:["gilthead seabream","red seabream","seabream","sea bream","dorade","orata"],
    species:"seabream", label:"Gilthead Seabream (EUMOFA 2023 + FAO MedAqua)",
    file:`${CDB}/aquaculture/performance.library.aquaculture.v2025.json`,
    breedFilter:"aquaculture/gilthead_seabream", structType:"performance_library" },

  { triggers:["pangasius","basa fish","tra fish","pangasius hypophthalmus","swai"],
    species:"pangasius", label:"Pangasius / Basa (FAO 2010 + Vietnam MARD 2022)",
    file:`${CDB}/aquaculture/performance.library.aquaculture.v2025.json`,
    breedFilter:"aquaculture/pangasius", structType:"performance_library" },

  { triggers:["milkfish","bangus","chanos chanos"],
    species:"milkfish", label:"Milkfish / Bangus (SEAFDEC + FAO)",
    file:`${CDB}/aquaculture/performance.library.aquaculture.v2025.json`,
    breedFilter:"aquaculture/milkfish", structType:"performance_library" },

  { triggers:["shrimp","prawn","litopenaeus","penaeus","vannamei","black tiger shrimp","whiteleg shrimp"],
    species:"shrimp", label:"Pacific White Shrimp / Vannamei (NRC 2011 + Global Shrimp Forum 2022)",
    file:`${CDB}/aquaculture/performance.library.aquaculture.v2025.json`,
    breedFilter:"aquaculture/vannamei_shrimp", structType:"performance_library" },

  { triggers:["fish","aquaculture","aquatic","finfish"],
    species:"fish", label:"Fish/Aquaculture",
    file:`${CDB}/aquaculture/performance.library.aquaculture.v2025.json`,
    breedFilter:"aquaculture/nile_tilapia_gift", structType:"performance_library" },

  // ── Companion Animals — Dog ───────────────────────────────────────────────
  // Giant breeds (mature BW >45 kg) — identified by breed name OR size descriptor
  { triggers:[
      "giant dog","giant breed dog","extra large dog","xxl dog","heavy dog","heavy breed dog","heavy breed",
      "great dane","saint bernard","st bernard","newfoundland","irish wolfhound",
      "english mastiff","mastiff","tibetan mastiff","cane corso","kangal",
      "leonberger","great pyrenees","pyrenean mountain dog","greater swiss mountain dog",
      "scottish deerhound","borzoi","black russian terrier","caucasian shepherd",
      "central asian shepherd","anatolian shepherd","turkish kangal","tosa inu","dogue de bordeaux",
      "great pyrenean","neapolitan mastiff","bullmastiff",
    ],
    species:"dog", label:"Dog – Giant Breed (Royal Canin 2022 + NRC 2006)",
    file:`${CDB}/companion/performance.library.companion.v2025.json`,
    breedFilter:"companion_dog/giant_breed", structType:"performance_library" },

  // Large breeds (mature BW 25–45 kg)
  { triggers:[
      "large dog","large breed dog","big dog","working dog","large breed",
      "labrador","labrador retriever","lab dog","golden retriever","golden lab",
      "german shepherd","alsatian","gsd","belgian malinois","malinois",
      "dobermann","doberman","doberman pinscher",
      "rottweiler","boxer dog","boxer breed",
      "bernese mountain dog","bernese","bernese dog",
      "giant schnauzer","bloodhound","rhodesian ridgeback","ridgeback",
      "alaskan malamute","malamute","akita","akita inu",
      "flat coated retriever","german short haired pointer","gsp","german shorthaired pointer",
      "weimaraner","vizsla","hungarian vizsla","irish setter","english setter","gordon setter",
      "airedale terrier","airedale","bouvier des flandres","hovawart","briard",
      "american bulldog","dutch shepherd","south african boerboel","boerboel",
      "australian shepherd","standard poodle","poodle standard",
    ],
    species:"dog", label:"Dog – Large Breed (Royal Canin 2022 + NRC 2006)",
    file:`${CDB}/companion/performance.library.companion.v2025.json`,
    breedFilter:"companion_dog/large_breed", structType:"performance_library" },

  // Medium breeds (mature BW 10–25 kg)
  { triggers:[
      "medium dog","medium breed dog","medium breed","standard dog",
      "border collie","springer spaniel","english springer spaniel","welsh springer spaniel",
      "whippet","siberian husky","husky","samoyed","shar pei","chow chow","dalmatian",
      "american staffordshire terrier","amstaff","staffy","bull terrier","staffordshire bull terrier",
      "basenji","keeshond","portuguese water dog","pwdb",
      "australian cattle dog","blue heeler","red heeler","cattle dog",
      "english bulldog","bulldog","cocker spaniel","american cocker spaniel","english cocker spaniel",
      "nova scotia duck tolling retriever","toller","lagotto romagnolo","lagotto",
      "finnish spitz","boykin spaniel","field spaniel","puli","pumi",
      "welsh corgi","corgi","pembroke corgi","cardigan corgi",
      "brittany spaniel","brittany dog","smooth collie","rough collie","lassie",
    ],
    species:"dog", label:"Dog – Medium Breed (Royal Canin 2022 + NRC 2006)",
    file:`${CDB}/companion/performance.library.companion.v2025.json`,
    breedFilter:"companion_dog/medium_breed", structType:"performance_library" },

  // Small breeds (mature BW 5–10 kg)
  { triggers:[
      "small dog","small breed dog","small breed","lightweight dog","light breed dog","light breed",
      "beagle","miniature schnauzer","mini schnauzer","cavalier king charles","cavalier","ckcs",
      "shih tzu","french bulldog","frenchie","pug","dachshund","sausage dog",
      "west highland white terrier","westie","jack russell terrier","jack russell","jrt",
      "scottish terrier","scottie","boston terrier","bichon frise","bichon",
      "lhasa apso","miniature poodle","poodle mini","norfolk terrier","cairn terrier",
      "dandie dinmont","coton de tulear","havanese","miniature dachshund","mini dachshund",
      "sussex spaniel","sealyham terrier","manchester terrier","toy fox terrier",
      "rat terrier","border terrier","lakeland terrier","welsh terrier",
    ],
    species:"dog", label:"Dog – Small Breed (Royal Canin 2022 + NRC 2006)",
    file:`${CDB}/companion/performance.library.companion.v2025.json`,
    breedFilter:"companion_dog/small_breed", structType:"performance_library" },

  // Toy breeds (mature BW <5 kg)
  { triggers:[
      "toy dog","toy breed dog","toy breed","miniature dog","teacup dog","tiny dog","dwarf dog",
      "chihuahua","yorkshire terrier","yorkie","pomeranian","maltese","toy poodle","poodle toy",
      "papillon","affenpinscher","brussels griffon","italian greyhound","miniature pinscher","min pin",
      "russian toy","japanese chin","silky terrier","chinese crested","biewer terrier","biewer",
      "english toy spaniel","king charles spaniel","king charles",
    ],
    species:"dog", label:"Dog – Toy Breed (Royal Canin 2022 + NRC 2006)",
    file:`${CDB}/companion/performance.library.companion.v2025.json`,
    breedFilter:"companion_dog/toy_breed", structType:"performance_library" },

  // Generic dog catch-all → defaults to medium breed
  { triggers:["dog","canine","puppy","puppies","pup","pups","whelp","young dog","puppy dog","dog puppy","bitch","dam","sire","hound","terrier","retriever","spaniel","pointer","setter","herding dog","guard dog","sport dog","working breed","sporting dog"],
    species:"dog", label:"Dog – Medium Breed (Royal Canin 2022 + NRC 2006)",
    file:`${CDB}/companion/performance.library.companion.v2025.json`,
    breedFilter:"companion_dog/medium_breed", structType:"performance_library" },

  // ── Companion Animals — Cat ───────────────────────────────────────────────
  // Large cat breeds (Maine Coon, Ragdoll, Norwegian Forest, Siberian etc.)
  { triggers:[
      "maine coon","large cat","large breed cat","big cat breed","heavy cat",
      "ragdoll cat","ragdoll","norwegian forest cat","norwegian forest","wegie",
      "siberian cat","siberian forest cat","siberian","british shorthair","british longhair",
      "savannah cat","savannah","chausie","turkish van","turkish angora","bengal cat",
    ],
    species:"cat", label:"Cat – Maine Coon (NRC 2006 + AAFCO 2023)",
    file:`${CDB}/companion/performance.library.companion.v2025.json`,
    breedFilter:"companion_cat/maine_coon", structType:"performance_library" },

  // Standard / small cat breeds (domestic shorthair, siamese, persian, etc.)
  { triggers:[
      "cat","feline","kitten","moggy","moggie","domestic cat",
      "domestic shorthair","domestic longhair","dsh","dlh","mixed breed cat",
      "siamese","persian cat","abyssinian","burmese cat","ragamuffin",
      "scottish fold","russian blue","devon rex","cornish rex","sphynx","hairless cat",
      "oriental shorthair","tonkinese","balinese cat","javanese cat","birman","birman cat",
      "american shorthair","american curl","manx","japanese bobtail","bombay cat","ocicat",
      "egyptian mau","somali cat","selkirk rex","turkish van","snowshoe cat",
    ],
    species:"cat", label:"Cat – Domestic Shorthair (NRC 2006 + AAFCO 2023)",
    file:`${CDB}/companion/performance.library.companion.v2025.json`,
    breedFilter:"companion_cat/domestic_shorthair", structType:"performance_library" },

  // ── Rabbit ────────────────────────────────────────────────────────────────
  { triggers:["new zealand white rabbit","nzw rabbit","new zealand white","nzw"],
    species:"rabbit", label:"Rabbit – New Zealand White (McNitt 2013 + De Blas & Wiseman 2010)",
    file:`${CDB}/rabbit/performance.library.rabbit.v2025.json`,
    breedFilter:"rabbit/new_zealand_white", structType:"performance_library" },
  { triggers:["californian rabbit","california rabbit"],
    species:"rabbit", label:"Rabbit – Californian (McNitt 2013 + De Blas & Wiseman 2010)",
    file:`${CDB}/rabbit/performance.library.rabbit.v2025.json`,
    breedFilter:"rabbit/californian", structType:"performance_library" },
  { triggers:["rex rabbit","rex"],
    species:"rabbit", label:"Rabbit – Rex (BRC 2022 + McNitt 2013)",
    file:`${CDB}/rabbit/performance.library.rabbit.v2025.json`,
    breedFilter:"rabbit/rex", structType:"performance_library" },
  { triggers:["angora rabbit","english angora","angora"],
    species:"rabbit", label:"Rabbit – English Angora (ARBA + BRC 2022)",
    file:`${CDB}/rabbit/performance.library.rabbit.v2025.json`,
    breedFilter:"rabbit/english_angora", structType:"performance_library" },
  { triggers:["rabbit","doe rabbit","buck rabbit","growing rabbit","lactating doe","gestating doe","kit","bunny","oryctolagus"],
    species:"rabbit", label:"Rabbit – New Zealand White (McNitt 2013 + De Blas & Wiseman 2010)",
    file:`${CDB}/rabbit/performance.library.rabbit.v2025.json`,
    breedFilter:"rabbit/new_zealand_white", structType:"performance_library" },

  // ── Camelids — Old World ──────────────────────────────────────────────────
  { triggers:["dromedary camel","arabian camel","one hump camel","camelus dromedarius"],
    species:"camel", label:"Dromedary Camel (Wardeh 1989 / Faye & Bengoumi 2018)",
    file:`${CDB}/camelid/performance.library.camelid.v2025.json`,
    breedFilter:"camelid/dromedary", structType:"performance_library" },
  { triggers:["bactrian camel","two hump camel","camelus bactrianus","mongolian camel","kazakh camel"],
    species:"camel", label:"Bactrian Camel (Faye & Bengoumi 2018)",
    file:`${CDB}/camelid/performance.library.camelid.v2025.json`,
    breedFilter:"camelid/bactrian", structType:"performance_library" },
  { triggers:["camel","camelid","dromedary","camelus"],
    species:"camel", label:"Dromedary Camel (Wardeh 1989 / Faye & Bengoumi 2018)",
    file:`${CDB}/camelid/performance.library.camelid.v2025.json`,
    breedFilter:"camelid/dromedary", structType:"performance_library" },

  // ── Camelids — South American ─────────────────────────────────────────────
  { triggers:["huacaya alpaca","huacaya"],
    species:"alpaca", label:"Alpaca – Huacaya (NRC 2007 / Van Saun 2006)",
    file:`${CDB}/camelid/performance.library.camelid.v2025.json`,
    breedFilter:"camelid/alpaca_huacaya", structType:"performance_library" },
  { triggers:["suri alpaca","suri"],
    species:"alpaca", label:"Alpaca – Suri (NRC 2007 / Van Saun 2006)",
    file:`${CDB}/camelid/performance.library.camelid.v2025.json`,
    breedFilter:"camelid/alpaca_suri", structType:"performance_library" },
  { triggers:["alpaca","vicugna pacos"],
    species:"alpaca", label:"Alpaca – Huacaya (NRC 2007 / Van Saun 2006)",
    file:`${CDB}/camelid/performance.library.camelid.v2025.json`,
    breedFilter:"camelid/alpaca_huacaya", structType:"performance_library" },
  { triggers:["llama","lama glama","pack llama"],
    species:"llama", label:"Llama (NRC 2007 / Van Saun 2006)",
    file:`${CDB}/camelid/performance.library.camelid.v2025.json`,
    breedFilter:"camelid/llama", structType:"performance_library" },
  { triggers:["vicuna","vicuña","vicugna vicugna","guanaco","lama guanicoe","south american camelid","sac camelid"],
    species:"alpaca", label:"South American Camelid (NRC 2007 / Van Saun 2006)",
    file:`${CDB}/camelid/performance.library.camelid.v2025.json`,
    breedFilter:"camelid/alpaca_huacaya", structType:"performance_library" },
];

// ─── Phase keyword map ────────────────────────────────────────────────────────

const PHASE_MAP = {
  prestarter: ["prestarter","pre-starter","pre starter","d0","day 0","day1","first week","hatch"],
  starter:    ["starter","start","chick start","wk1","wk2","wk 1","0-14","0-21","early chick"],
  grower:     ["grower","grow","growing","grower1","grower 1","wk3","wk4","14-28","d21"],
  finisher:   ["finisher","finish","finishing","finisher1","finisher 1","withdrawal","wk5","wk6","d35","d42"],
  prelay:     ["prelay","pre-lay","pre lay","pullet","pullet rearing","developer"],
  rearing:    ["rearing","rear","grow-out","growout","starter 1","starter 2","developer"],
  early:      ["early lay","early","early production","pre-peak","pre peak","prepeak","approaching peak","approaching lay","pre peak period"],
  // late MUST come before peak — "post-peak" contains "peak" as substring so order matters
  late:       ["late lay","late","end of lay","low production","post-peak","post peak","postpeak","post peak period","declining production","declining lay","second half","post lay peak","after peak","post lay","lay_late"],
  peak:       ["peak","peak lay","peak production","high production","at peak","full peak","lay_peak"],
  mid:        ["mid lay","mid production","mid-lay","second phase","lay_mid","second period","middle lay","mid period"],
  developer:  ["developer","development","dev","pre_breeder","pre breeder","prebreeder","pre-breeder"],
  prebreed:   ["prebreed","pre-breed","pre breed","pre_breed","prebreed phase","holding period","pre breed phase"],
  breeder:    ["breeder","breeder_1","breeder_2","breeder_3","breeder stock","parent stock","in lay","grandparent"],
  // ── Equine phases — MUST come before swine nursery so "weanling" doesn't match "wean" in nursery ──
  weanling:       ["weanling","weaned foal","weanling horse"],
  yearling:       ["yearling","yearling horse","yearling filly","yearling colt"],
  foal:           ["foal","nursing foal","suckling foal","newborn foal","young foal"],
  maintenance:    ["maintenance","adult horse","mature horse","idle horse","at rest"],
  very_heavy_work:["very heavy work","very heavy","race horse","racing horse","racing","elite horse","endurance horse","endurance racing"],
  heavy_work:     ["heavy work","heavy exercise","heavy training","competition horse","show horse","polo horse"],
  moderate_work:  ["moderate work","moderate exercise","moderate training","moderate riding","regular work"],
  light_work:     ["light work","light exercise","light riding","light training","pleasure riding","trail riding"],
  early_gestation:["early gestation","early pregnancy","first trimester","early pregnant"],
  late_gestation: ["late gestation","late pregnancy","third trimester","late pregnant mare","pregnant mare","gestating mare","gestation"],
  peak_lactation: ["peak lactation","early lactation","nursing mare","foaling mare","peak milk","mare milk","lactation"],
  late_lactation: ["late lactation","declining lactation","weaning lactation","late nursing"],
  senior:         ["senior horse","senior","aged horse","old horse","geriatric horse","older horse"],
  metabolic:      ["metabolic","metabolic horse","insulin resistant","insulin resistance","laminitis","laminitic","low nsc","low sugar","low starch","cushing","ppid","ems"],
  breeding:       ["breeding stallion","stud horse","stud","breeding horse","at stud","breeding","breeder phase","stallion"],
  growth:         ["growth","growing horse","foal period","weanling period","yearling period"],
  reproduction:   ["pregnant","mare reproduction","gestation period","reproduction","lactating"],
  // ── Swine nursery / production phases ────────────────────────────────────────
  nursery:    ["nursery","weaner","weaning","young pig","piglet","suckling"],
  nursery_p1: ["nursery","nursery phase 1","nursery p1","early nursery","7kg","7 kg"],
  nursery_p2: ["nursery phase 2","nursery p2","late nursery","12kg","12 kg"],
  grower_p1:  ["grower phase 1","grower p1","early grower","20kg","growing pig"],
  finisher_p1:["finisher pig","finishing pig","market pig","slaughter pig","100kg"],
};

// ─── Requirements Engine Map ─────────────────────────────────────────────────
// Maps species → requirements engine .cjs path for actual nutrient values

const REQUIREMENTS_ENGINE_MAP = {
  goat:      path.resolve(process.cwd(), "core/services/requirements/goat/goatNrc2007.engine.cjs"),
  sheep:     path.resolve(process.cwd(), "core/services/requirements/sheep/sheepNrc2007.engine.cjs"),
  beef:      path.resolve(process.cwd(), "core/services/requirements/beef/beefNasem2016.engine.cjs"),
  dairy:     path.resolve(process.cwd(), "core/services/requirements/dairy/dairyNasem2021.engine.cjs"),
  swine:     path.resolve(process.cwd(), "core/services/requirements/swine/swinePic2021.engine.cjs"),
  dog:       path.resolve(process.cwd(), "core/services/requirements/dog/dogEngine.cjs"),
  cat:       path.resolve(process.cwd(), "core/services/requirements/cat/catEngine.cjs"),
  shrimp:    path.resolve(process.cwd(), "core/services/requirements/aqua/shrimpNrc2011.engine.cjs"),
  salmon:    path.resolve(process.cwd(), "core/services/requirements/aqua/salmonNrc2011.engine.cjs"),
  trout:     path.resolve(process.cwd(), "core/services/requirements/aqua/salmonNrc2011.engine.cjs"),
  tilapia:   path.resolve(process.cwd(), "core/services/requirements/aqua/tilapiaEngine.cjs"),
  catfish:   path.resolve(process.cwd(), "core/services/requirements/aqua/catfishEngine.cjs"),
  pangasius: path.resolve(process.cwd(), "core/services/requirements/aqua/pangasiusEngine.cjs"),
  milkfish:  path.resolve(process.cwd(), "core/services/requirements/aqua/milkfishEngine.cjs"),
  carp:      path.resolve(process.cwd(), "core/services/requirements/aqua/carpEngine.cjs"),
  seabass:   path.resolve(process.cwd(), "core/services/requirements/aqua/seabassSeabreamEngine.cjs"),
  seabream:  path.resolve(process.cwd(), "core/services/requirements/aqua/seabassSeabreamEngine.cjs"),
  rabbit:    path.resolve(process.cwd(), "core/services/requirements/rabbit/rabbitEngine.cjs"),
  camel:     path.resolve(process.cwd(), "core/services/requirements/camelid/camelEngine.cjs"),
  dromedary: path.resolve(process.cwd(), "core/services/requirements/camelid/camelEngine.cjs"),
  bactrian:  path.resolve(process.cwd(), "core/services/requirements/camelid/camelEngine.cjs"),
  alpaca:    path.resolve(process.cwd(), "core/services/requirements/camelid/sacEngine.cjs"),
  llama:     path.resolve(process.cwd(), "core/services/requirements/camelid/sacEngine.cjs"),
  vicuna:    path.resolve(process.cwd(), "core/services/requirements/camelid/sacEngine.cjs"),
  south_american_camelid: path.resolve(process.cwd(), "core/services/requirements/camelid/sacEngine.cjs"),
};

const NUTRIENT_REQUIREMENT_SIGNALS = [
  // Core nutrient/requirement words
  "nutrient","nutrition","nutritional","nutri","nutron","requirement","dietary",
  "how much","what is the cp","what is the me","what is the mp",
  "energy requirement","protein requirement","calcium requirement","phosphorus requirement",
  "cp ","me:","me/kg","mineral requirement","vitamin requirement","amino acid",
  // Individual nutrients — presence alone signals a nutrition question
  "lysine","methionine","threonine","tryptophan","arginine","valine","isoleucine","leucine",
  "selenium","zinc","copper","iron","manganese","iodine","cobalt",
  "calcium","phosphorus","sodium","potassium","magnesium","chloride",
  "vitamin a","vitamin b","vitamin c","vitamin d","vitamin e","vitamin k",
  "niacin","biotin","choline","folic","pantothenic",
  "crude protein","crude fiber","crude fat","ether extract","dry matter",
  "ndf","adf","tdn","mcal","mj/kg",
  // Common query forms
  "nutrinet","nutri req","feed require","diet require","nutrition require",
  "ration","formulation standard","feed spec","dietary spec","dietary standard",
  "what is the nutrient","what are the nutrient","feed composition",
  "protein level","energy level","mineral level","vitamin level",
  "diet formulation","diet composition","feed formulation","feed standard",
  "nutrient profile","nutrition profile","diet profile",
  "what to feed","how to feed","feed for","nutrition for","nutrients for",
  "nutrient need","protein need","energy need","mineral need"
];

function isNutrientRequirementQuery(q) {
  const lower = String(q || "").toLowerCase().replace(/\bnutrix\b/g, " ");
  return NUTRIENT_REQUIREMENT_SIGNALS.some(s => lower.includes(s));
}

function lookupFeatureById(id) {
  const want = String(id || "").trim();
  if (!want) return null;
  return (loadFeatureGuide().features || []).find(f => f.id === want) || null;
}

function isSoftwareHelpQuestion(question) {
  return HELP_QUESTION_REGEX.test(question)
    || /\b(my formulas?|saved formulas?|copy (a )?formula|raw materials|formula analyzer|multimix|premix|qc lab|nutrix ai|how and where)\b/i.test(question);
}

function loadEngineStaticRequirements(species) {
  const enginePath = REQUIREMENTS_ENGINE_MAP[species];
  if (!enginePath) return null;
  try {
    const mod = require(enginePath);
    return mod.STATIC_REQUIREMENTS || null;
  } catch { return null; }
}

function matchRequirementsPhase(staticReqs, query, lenient = false) {
  if (!staticReqs) return null;
  const q = query.toLowerCase();
  const tokens = q.split(/\W+/).filter(t => t.length >= 3);

  let bestKey = null;
  let bestScore = 0;

  for (const [key, phase] of Object.entries(staticReqs)) {
    if (!phase || typeof phase !== 'object') continue;
    const searchStr = `${key} ${phase.label||''} ${phase.production||''} ${phase.phase||''}`.toLowerCase()
      .replace(/-/g,'_').replace(/\s+/g,' ');

    let score = 0;
    for (const token of tokens) {
      if (searchStr.includes(token)) score++;
    }
    // Bonus for exact compound-phrase matches
    const compoundPhrases = [
      ['early gestation','early_gestation'], ['late gestation','late_gestation'],
      ['early lactation','early_lactation'], ['peak lactation','peak_lactation'],
      ['mid lactation','mid_lactation'], ['late lactation','late_lactation'],
      ['dry cow','dry_'], ['close up','close_up'], ['far off','far_off'],
      ['pre weaning','pre_wean'], ['post weaning','post_wean'],
      ['early lay','early'], ['peak lay','peak'], ['late lay','late'],
      ['stocker light','stocker_light'], ['stocker heavy','stocker_heavy'],
      ['feedlot','feedlot'], ['finishing','finish'], ['receiving','receiving'],
      ['buck maintenance','buck_maintenance'], ['buck breeding','buck_breeding'],
      ['doe maintenance','doe_maintenance'], ['ram maintenance','ram_maintenance'],
      ['lamb growing','lamb_growing'], ['lamb finishing','lamb_finishing'],
      // ── Life-stage priority overrides (explicit stage beats animal-type word) ──
      // Dog / cat — explicit life stage keywords
      ['puppy','growth_puppy'], ['puppy stage','growth_puppy'], ['growing puppy','growth_puppy'], ['young puppy','growth_puppy'],
      ['kitten','growth'], ['kitten stage','growth'], ['growing kitten','growth'], ['young kitten','growth'],
      ['senior dog','senior'], ['older dog','senior'], ['geriatric dog','senior'], ['aged dog','senior'],
      ['senior cat','senior'], ['older cat','senior'], ['geriatric cat','senior'], ['mature cat','senior'], ['aged cat','senior'], ['old cat','senior'],
      ['neonatal puppy','growth_puppy'], ['newborn puppy','growth_puppy'], ['nursing puppy','growth_puppy'], ['weaning puppy','growth_puppy'],
      ['neonatal kitten','growth'], ['newborn kitten','growth'], ['nursing kitten','growth'], ['weaning kitten','growth'],
      ['working dog','adult_maintenance'], ['active dog','adult_maintenance'], ['sport dog','adult_maintenance'],
      ['pregnant cat','gestation_lactation'], ['nursing cat','gestation_lactation'], ['lactating cat','gestation_lactation'], ['queen cat','gestation_lactation'],
      ['pregnant dog','gestation_lactation'], ['nursing dog','gestation_lactation'], ['lactating dog','gestation_lactation'],

      // ── Pregnancy / gestation synonyms (all species) ──
      ['pregnancy','gestation'], ['in pregnancy','gestation'], ['during pregnancy','gestation'],
      ['pregnant','gestation'], ['gestating','gestation'], ['gravid','gestation'], ['expecting','gestation'],
      ['gestation period','gestation'], ['in calf','gestation'], ['in lamb','gestation'],
      ['in kid','gestation'], ['in pig','gestation'], ['with foal','gestation'],
      ['late pregnancy','late_gestation'], ['near term','late_gestation'],
      ['close to lambing','late_gestation'], ['pre-lambing','late_gestation'], ['flushing','late_gestation'],
      ['close to kidding','late_gestation'], ['close to calving','late_gestation'],
      ['last trimester','late_gestation'], ['third trimester','late_gestation'],
      ['with lamb','late_gestation'], ['with kid','late_gestation'], ['with calf','gestation'],
      ['twin pregnancy','late_gestation_twins'], ['carrying twins','late_gestation_twins'], ['twins','late_gestation_twins'],
      ['triplets','late_gestation_twins'], ['multiple lambs','late_gestation_twins'],
      ['single pregnancy','late_gestation_single'], ['single lamb','late_gestation_single'],
      ['early pregnancy','early_gestation'], ['first half pregnancy','early_gestation'], ['first trimester','early_gestation'],

      // ── Lactation synonyms (all species) ──
      ['lactating','lactation'], ['nursing','lactation'], ['suckling','lactation'], ['milking','lactation'],
      ['nursing young','lactation'], ['feeding young','lactation'],
      ['gestation lactation','gestation_lactation'], ['pregnant nursing','gestation_lactation'],
      ['early lactation','early_lactation'], ['fresh cow','early_lactation'], ['just calved','early_lactation'],
      ['early fresh','early_lactation'], ['freshening','early_lactation'],
      ['peak lactation','peak_lactation'], ['peak milk','peak_lactation'], ['peak production cow','peak_lactation'],
      ['mid lactation','mid_lactation'], ['mid milk','mid_lactation'],
      ['late lactation','late_lactation'], ['drying off','late_lactation'],
      ['nursing ewe','early_lactation_single'], ['nursing doe','early_lactation'],
      ['nursing twins','early_lactation_twins'], ['twin lambs','early_lactation_twins'],

      // ── Dry / maintenance synonyms ──
      ['dry period','dry'], ['far off','far_off'], ['dry cow','dry'],
      ['non-pregnant','ewe_maintenance'], ['open cow','maintenance'], ['idle','maintenance'],
      ['not lactating','maintenance'], ['empty ewe','ewe_maintenance'], ['dry ewe','ewe_maintenance'],
      ['adult maintenance','adult_maintenance'], ['maintenance phase','adult_maintenance'],

      // ── Transition / close-up ──
      ['close up','close_up'], ['transition cow','close_up'], ['pre-fresh','close_up'],
      ['pre-partum','close_up'], ['steaming up','close_up'],

      // ── Beef / stocker / feedlot ──
      ['growing calf','stocker_light'], ['stocker calf','stocker_light'], ['light stocker','stocker_light'],
      ['heavy stocker','stocker_heavy'], ['feedlot steer','feedlot'], ['finishing steer','finishing'],
      ['receiving cattle','receiving'], ['backgrounding','stocker_light'],

      // ── Sheep / goat stage synonyms ──
      ['breeding ewe','breeding'], ['flushing ewe','breeding'], ['breeding doe','breeding'],
      ['late gestation ewe','late_gestation'], ['lambing','late_gestation'], ['kidding','late_gestation'],
      ['lamb growing','lamb_growing'], ['lamb finishing','lamb_finishing'],
      ['weaned lamb','post_wean'], ['growing lamb','lamb_growing'], ['finishing lamb','lamb_finishing'],
      ['ram season','ram_breeding'], ['buck season','buck_breeding'],

      // ── Swine stage synonyms ──
      ['nursery pig','nursery'], ['weaner pig','nursery'], ['wean pig','nursery'],
      ['early nursery','nursery_p1'], ['late nursery','nursery_p2'],
      ['grower pig','grower_p1'], ['growing pig','grower_p1'],
      ['finisher pig','finisher_p1'], ['finishing pig','finisher_p1'],
      ['farrowing','gestation'], ['gestating sow','gestation'], ['sow gestation','gestation'],

      // ── Poultry stage synonyms ──
      ['chick phase','starter'], ['starter phase','starter'], ['brooding','starter'],
      ['grower phase','grower'], ['growing phase','grower'],
      ['finisher phase','finisher'], ['pre-slaughter','finisher'],
      ['early lay','early_lay'], ['peak lay','peak_lay'], ['late lay','late_lay'],

      // ── Aquaculture / fish stage synonyms ──
      ['fingerling','fingerling'], ['juvenile fish','juvenile'], ['grow out fish','grow_out'],
      ['market fish','harvest'], ['harvest size','harvest'],

      // ── Rabbit stage synonyms ──
      ['kit rabbit','neonatal'], ['weaned rabbit','post_weaning'], ['grow out rabbit','grow_out'],
      ['pregnant doe rabbit','gestation'], ['nursing doe rabbit','lactation'],

      // ── Camelid stage synonyms ──
      ['calf camel','calf'], ['young camel','juvenile'], ['working camel','mature'],

      // ── Generic life stage → key fragment mappings ──
      ['growing','growth'], ['grow out','grow_out'], ['juvenile','juvenile'],
    ];
    for (const [phrase, fragment] of compoundPhrases) {
      if (q.includes(phrase) && searchStr.includes(fragment)) score += 2;
    }

    if (score > bestScore) { bestScore = score; bestKey = key; }
  }

  return (lenient || bestScore >= 1) ? { key: bestKey, data: staticReqs[bestKey] } : null;
}

function formatEngineRequirementsAnswer(phaseData, entryLabel) {
  if (!phaseData) return null;
  const title = phaseData.label || entryLabel || 'Nutrient Requirements';
  const lines = [`**${title}**\n`];

  if (phaseData.energy && Object.keys(phaseData.energy).length) {
    lines.push("**Energy**");
    const e = phaseData.energy;
    // Ruminant / swine (ME / NE system)
    if (e.me_mcal_kg != null) lines.push(`  • ME: ${e.me_mcal_kg} Mcal/kg DM`);
    if (e.me_mj_kg != null)   lines.push(`  • ME: ${e.me_mj_kg} MJ/kg DM`);
    if (e.nel_mcal_kg != null) lines.push(`  • NEL: ${e.nel_mcal_kg} Mcal/kg DM`);
    if (e.nem_mcal_kg != null) lines.push(`  • NEm: ${e.nem_mcal_kg} Mcal/kg DM`);
    if (e.neg_mcal_kg != null) lines.push(`  • NEg: ${e.neg_mcal_kg} Mcal/kg DM`);
    if (e.tdn != null)         lines.push(`  • TDN: ${e.tdn}%`);
    // Aquaculture / Rabbit (DE system)
    if (e.de_kcal_kg != null)  lines.push(`  • DE: ${e.de_kcal_kg} kcal/kg`);
    if (e.de_mj_kg != null)    lines.push(`  • DE: ${e.de_mj_kg} MJ/kg`);
  }

  if (phaseData.protein && Object.keys(phaseData.protein).length) {
    lines.push("**Protein & Amino Acids**");
    const p = phaseData.protein;
    // Ruminant
    if (p.cp != null)           lines.push(`  • CP: ${p.cp}%`);
    if (p.mp_g_day != null)     lines.push(`  • MP: ${p.mp_g_day} g/day`);
    if (p.rdp_pct_cp != null)   lines.push(`  • RDP: ${p.rdp_pct_cp}% of CP`);
    if (p.rup_pct_cp != null)   lines.push(`  • RUP: ${p.rup_pct_cp}% of CP`);
    if (p.rdp_pct != null)      lines.push(`  • RDP: ${p.rdp_pct}%`);
    if (p.rup_pct != null)      lines.push(`  • RUP: ${p.rup_pct}%`);
    // Aquaculture / Rabbit (digestible protein + AAs as % of diet DM)
    if (p.cp_pct != null && p.cp == null) lines.push(`  • CP: ${p.cp_pct}%`);
    if (p.dp_pct != null)       lines.push(`  • DP (digestible): ${p.dp_pct}%`);
    if (p.lys != null)          lines.push(`  • Lys: ${p.lys}%`);
    if (p.met != null)          lines.push(`  • Met: ${p.met}%`);
    if (p.met_cys != null)      lines.push(`  • Met+Cys: ${p.met_cys}%`);
    if (p.thr != null)          lines.push(`  • Thr: ${p.thr}%`);
    if (p.arg != null)          lines.push(`  • Arg: ${p.arg}%`);
    if (p.ile != null)          lines.push(`  • Ile: ${p.ile}%`);
    if (p.leu != null)          lines.push(`  • Leu: ${p.leu}%`);
    if (p.val != null)          lines.push(`  • Val: ${p.val}%`);
    if (p.trp != null)          lines.push(`  • Trp: ${p.trp}%`);
    if (p.his != null)          lines.push(`  • His: ${p.his}%`);
  }

  // Aquaculture lipids (EPA+DHA is a key requirement for marine species)
  if (phaseData.lipids && Object.keys(phaseData.lipids).length) {
    lines.push("**Lipids**");
    const l = phaseData.lipids;
    if (l.total_lipid_pct != null) lines.push(`  • Total fat: ${l.total_lipid_pct}%`);
    if (l.linoleic_pct != null)    lines.push(`  • Linoleic acid: ${l.linoleic_pct}%`);
    if (l.epa_dha_pct != null)     lines.push(`  • EPA+DHA: ${l.epa_dha_pct}%`);
    if (l.n3_hufa_pct != null)     lines.push(`  • n-3 HUFA: ${l.n3_hufa_pct}%`);
  }

  if (phaseData.fiber && Object.keys(phaseData.fiber).length) {
    lines.push("**Fiber**");
    const f = phaseData.fiber;
    // Ruminant (minimums)
    if (f.ndf_min != null)         lines.push(`  • NDF min: ${f.ndf_min}%`);
    if (f.adf_min != null)         lines.push(`  • ADF min: ${f.adf_min}%`);
    // Rabbit (requirements — critical for gut health)
    if (f.crude_fiber_pct != null) lines.push(`  • Crude Fiber: ${f.crude_fiber_pct}%`);
    if (f.adf_pct != null)         lines.push(`  • ADF: ${f.adf_pct}%`);
    if (f.ndf_pct != null)         lines.push(`  • NDF: ${f.ndf_pct}%`);
  }

  if (phaseData.minerals && Object.keys(phaseData.minerals).length) {
    lines.push("**Minerals**");
    const m = phaseData.minerals;
    const ppmKeys = new Set(['co_ppm','cu_ppm','i_ppm','fe_ppm','mn_ppm','se_ppm','zn_ppm','mo_ppm','cr_ppm','f_ppm']);
    // Ruminant keys (plain %)
    const mineralOrder = ['ca','p','mg','k','na','cl','s','co_ppm','cu_ppm','i_ppm','fe_ppm','mn_ppm','se_ppm','zn_ppm','mo_ppm'];
    const mineralLabels = { ca:'Ca',p:'P',mg:'Mg',k:'K',na:'Na',cl:'Cl',s:'S',
      co_ppm:'Co',cu_ppm:'Cu',i_ppm:'I',fe_ppm:'Fe',mn_ppm:'Mn',se_ppm:'Se',zn_ppm:'Zn',mo_ppm:'Mo' };
    for (const k of mineralOrder) {
      if (m[k] != null) {
        const unit = ppmKeys.has(k) ? 'ppm' : '%';
        lines.push(`  • ${mineralLabels[k]}: ${m[k]} ${unit}`);
      }
    }
    // Aquaculture / Rabbit macro minerals (_pct suffix — not covered by loop above)
    if (m.ca_pct != null && m.ca == null)          lines.push(`  • Ca: ${m.ca_pct}%`);
    if (m.p_pct != null && m.p == null)            lines.push(`  • P (total): ${m.p_pct}%`);
    if (m.avail_p_pct != null)                     lines.push(`  • P (available): ${m.avail_p_pct}%`);
    if (m.mg_pct != null && m.mg == null)          lines.push(`  • Mg: ${m.mg_pct}%`);
    if (m.k_pct != null && m.k == null)            lines.push(`  • K: ${m.k_pct}%`);
    if (m.na_pct != null && m.na == null)          lines.push(`  • Na: ${m.na_pct}%`);
    if (m.cl_pct != null && m.cl == null)          lines.push(`  • Cl: ${m.cl_pct}%`);
    // Note: _ppm trace minerals (fe_ppm, zn_ppm, mn_ppm, cu_ppm, se_ppm, i_ppm)
    // are already printed by the mineralOrder loop above — no duplication needed.
  }

  if (phaseData.vitamins && Object.keys(phaseData.vitamins).length) {
    lines.push("**Vitamins**");
    const v = phaseData.vitamins;
    // Static library format (IU or mg stored directly)
    if (v.vit_a != null) lines.push(`  • Vit A: ${v.vit_a} IU/kg`);
    if (v.vit_d != null) lines.push(`  • Vit D: ${v.vit_d} IU/kg`);
    if (v.vit_e != null) lines.push(`  • Vit E: ${v.vit_e} IU/kg`);
    if (v.vit_k != null) lines.push(`  • Vit K: ${v.vit_k} mg/kg`);
    // Aquaculture / Rabbit engine format (_iu_kg / _mg_kg suffix)
    if (v.vit_a_iu_kg != null)   lines.push(`  • Vit A: ${v.vit_a_iu_kg} IU/kg`);
    if (v.vit_d_iu_kg != null)   lines.push(`  • Vit D: ${v.vit_d_iu_kg} IU/kg`);
    if (v.vit_e_mg_kg != null)   lines.push(`  • Vit E: ${v.vit_e_mg_kg} mg/kg`);
    if (v.vit_c_mg_kg != null)   lines.push(`  • Vit C: ${v.vit_c_mg_kg} mg/kg`);
    if (v.niacin_mg_kg != null)  lines.push(`  • Niacin: ${v.niacin_mg_kg} mg/kg`);
    if (v.choline_mg_kg != null) lines.push(`  • Choline: ${v.choline_mg_kg} mg/kg`);
    if (v.inositol_mg_kg != null) lines.push(`  • Inositol: ${v.inositol_mg_kg} mg/kg`);
  }

  // feed_management (FCR, feeding rate) is production performance — excluded from nutrient answers.

  if (phaseData.cu_warning) lines.push(`\n> ⚠️ ${phaseData.cu_warning}`);

  const srcTag = title.includes('NASEM 2021') ? 'NASEM 2021'
    : title.includes('NASEM 2016') ? 'NASEM 2016'
    : title.includes('NRC 2011') ? 'NRC 2011 + Literature'
    : title.includes('NRC 1977') || title.includes('De Blas') ? 'NRC 1977 / De Blas & Wiseman 2010'
    : 'NRC 2007';
  lines.push(`\n*Source: ${srcTag} (Nutrix requirements engine)*`);

  return lines.join("\n");
}

// ─── Daily intake parser ──────────────────────────────────────────────────────
// Extracts feed intake in grams/day from natural language queries like
// "consuming 100 gm", "100 g feed intake", "feed intake 120 grams"

function detectDailyIntake(question) {
  const patterns = [
    /consuming\s+(\d+(?:\.\d+)?)\s*(?:gm|g(?:rams?)?\b)/i,
    /intake\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(?:gm|g(?:rams?)?\b)/i,
    /(\d+(?:\.\d+)?)\s*(?:gm|gram[s]?)\s+(?:feed|diet|per day|daily)/i,
    /feed\s+(?:consumption|intake)\s+(?:is\s+)?(\d+(?:\.\d+)?)\s*(?:gm|g(?:rams?)?\b)/i,
    /eating\s+(\d+(?:\.\d+)?)\s*(?:gm|g(?:rams?)?\b)/i,
    /on\s+(\d+(?:\.\d+)?)\s*(?:gm|g(?:rams?)?\b)\s+(?:feed|diet)/i,
    /(\d+(?:\.\d+)?)\s*g(?:m|rams?)?\s+(?:feed|diet)\b/i,
    /(\d+(?:\.\d+)?)\s*g(?:m|rams?)?\s*(?:\/day|\/d|\/hen|\/bird|per\s+day|per\s+hen|per\s+bird)\b/i,
    // Catch "with 100 g", "at 100 g", "use 100 g" etc.
    /(?:with|at|use|using|for|try)\s+(\d+(?:\.\d+)?)\s*g(?:m|rams?)?\b/i,
    // Last resort: bare "NNN gm" or "NNN g" — only match intake-range numbers (50–500g)
    // to avoid false-matching nutrient values like "ME 2950" or "19 CP"
    /\b(\d+(?:\.\d+)?)\s*gm\b/i,
    /\b((?:5\d|[6-9]\d|[1-4]\d{2}|500)(?:\.\d+)?)\s*g\b/i,
  ];
  for (const re of patterns) {
    const m = question.match(re);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

// ─── Intake inheritance from history ─────────────────────────────────────────
// When the current query doesn't specify a feed intake, look back through user
// messages for the last one that mentioned grams (e.g. "consuming 110 g").
// This prevents the LLM from substituting its own default (e.g. 100 g/hen/day).
function getLastIntakeFromHistory(history) {
  if (!Array.isArray(history) || !history.length) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'assistant') continue;
    const text = (msg.text || msg.content || '').trim();
    const intake = detectDailyIntake(text);
    if (intake) return intake;
  }
  return null;
}

// ─── All-intake parser ────────────────────────────────────────────────────────
// Returns ALL feed intake values mentioned in a query (e.g. "100, 110 or 120 g" → [100,110,120])
function detectAllIntakes(question) {
  const results = [];
  // Find all numbers that are immediately followed by g/gm/gram (or are part of a list before one)
  // e.g. "100, 110 or 120 g" → all three; "at 100 g" → [100]
  const listMatch = question.match(/(\d+(?:\.\d+)?)\s*[,/or\s]+(\d+(?:\.\d+)?)\s*[,/or\s]+(\d+(?:\.\d+)?)\s*g(?:m|rams?)?\b/i);
  if (listMatch) return [parseFloat(listMatch[1]), parseFloat(listMatch[2]), parseFloat(listMatch[3])];
  const pairMatch = question.match(/(\d+(?:\.\d+)?)\s*[,/or\s]+(\d+(?:\.\d+)?)\s*g(?:m|rams?)?\b/i);
  if (pairMatch) return [parseFloat(pairMatch[1]), parseFloat(pairMatch[2])];
  const single = detectDailyIntake(question);
  if (single) return [single];
  return [];
}

// ─── History entry resolver ────────────────────────────────────────────────────
// When the current query is a follow-up with no species/breed trigger, recover
// the last matched library entry (breed + phase) from conversation history.
function getEntryFromHistory(history) {
  if (!Array.isArray(history) || !history.length) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'assistant') continue;
    const text = (msg.text || msg.content || '').trim();
    const parsed = parseLibraryQuery(text);
    if (parsed?.entry) return { entry: parsed.entry, phase: parsed.phase };
  }
  return null;
}

// ─── History resolver ────────────────────────────────────────────────────────
// When the user asks a follow-up like "what if 120g" or just "120",
// scan previous messages for the last successful library query and reuse its
// breed/phase with the new intake value.

const INTAKE_CHANGE_RE = /^[\s\w,.'!?]*(?:change|changed|what if|try|now|instead|use|with|at|make it|set to|use|recalculate|recalc)\b[\s\w]*(\d+(?:\.\d+)?)\s*(?:gm|g\b|grams?|gram)?|^(\d+(?:\.\d+)?)\s*(?:gm|g\b|grams?|gram)?\s*$/i;

function resolveFromHistory(question, history) {
  if (!Array.isArray(history) || !history.length) return null;

  // Detect if question is purely "change intake to X" or just "X gm"
  const simpleIntake = question.match(/(\d+(?:\.\d+)?)\s*(?:gm|g\b|grams?|gram)?/i);
  if (!simpleIntake) return null;

  const isIntakeOnly =
    INTAKE_CHANGE_RE.test(question.trim()) ||
    /^(\d+(?:\.\d+)?)\s*(?:gm|g\b|grams?)?$/i.test(question.trim());

  if (!isIntakeOnly) return null;

  const newIntake = parseFloat(simpleIntake[1]);

  // Walk history backwards to find last message with a library hit
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const text = (msg.text || msg.content || '').trim();
    if (!text || msg.role === 'assistant') continue;
    const parsed = parseLibraryQuery(text);
    if (parsed?.entry) {
      return { ...parsed, dailyIntakeG: newIntake, resolvedFrom: text.slice(0, 60) };
    }
  }
  return null;
}

// ─── Query parser ─────────────────────────────────────────────────────────────

const ALL_TRIGGERS = LIBRARY_CATALOG.flatMap(e => e.triggers);

const REQUIRE_SIGNALS = [
  "nutrient","requirement","requirment","requirments","standard","spec","target","diet","feed",
  "phase","protein","energy","amino","lysine","methionine","threonine","tryptophan",
  "cp%","me ","ame","sid","sid lys","growth","production","nutrition","nutrit","nutrinet",
  "starter","grower","finisher","prelay","peak","nursery","rearing","formul","ration",
  ...ALL_TRIGGERS
];

function parseLibraryQuery(question) {
  const q = question.toLowerCase();
  const isLibraryQuery = REQUIRE_SIGNALS.some(s => q.includes(s.toLowerCase()));
  if (!isLibraryQuery) return null;

  // Detect phase — exact keyword match first
  let detectedPhase = null;
  for (const [phase, keywords] of Object.entries(PHASE_MAP)) {
    if (keywords.some(kw => q.includes(kw))) { detectedPhase = phase; break; }
  }

  // Fuzzy fallback: tolerate typos like "fisihser" for "finisher"
  // Uses simple edit distance (≤ 2 for words ≥ 6 chars, ≤ 1 for shorter)
  if (!detectedPhase) {
    const editDist = (a, b) => {
      if (Math.abs(a.length - b.length) > 3) return 99;
      const dp = Array.from({length: a.length + 1}, (_, i) => i);
      for (let j = 1; j <= b.length; j++) {
        let prev = j;
        for (let i = 1; i <= a.length; i++) {
          const cur = a[i-1] === b[j-1] ? dp[i-1] : 1 + Math.min(dp[i-1], dp[i], prev);
          dp[i-1] = prev;
          prev = cur;
        }
        dp[a.length] = prev;
      }
      return dp[a.length];
    };
    const words = q.split(/\s+/).filter(w => w.length >= 4);
    outer:
    for (const [phase, keywords] of Object.entries(PHASE_MAP)) {
      for (const kw of keywords) {
        if (kw.length < 4) continue;
        const maxDist = kw.length >= 6 ? 2 : 1;
        if (words.some(w => editDist(w, kw) <= maxDist)) {
          detectedPhase = phase;
          break outer;
        }
      }
    }
  }

  // Week-age → phase inference for layers (when no keyword phase was detected)
  // Handles queries like "40 weeks" or "wk 40" that don't match PHASE_MAP keywords
  let phaseFromWeekInference = false;
  if (!detectedPhase) {
    const weekMatch = q.match(/\b(\d+)\s*(?:weeks?|wks?|wk)\b/);
    if (weekMatch) {
      const wk = parseInt(weekMatch[1]);
      const isLayerQuery = /layer|laying hen|lay hen|isa|lohmann|hyline|bovans|lsl|nick chick|dekalb|hi.?sex|novogen|hen/.test(q);
      const isBroilerQuery = /broiler|ross|cobb|hubbard|arbor/.test(q);
      if (isLayerQuery && !isBroilerQuery) {
        // Commercial layer week → production phase mapping
        if (wk <= 6)       detectedPhase = 'starter';
        else if (wk <= 12) detectedPhase = 'grower';
        else if (wk <= 15) detectedPhase = 'developer';
        else if (wk <= 17) detectedPhase = 'prelay';
        else if (wk <= 22) detectedPhase = 'early';
        else if (wk <= 42) detectedPhase = 'peak';
        else if (wk <= 56) detectedPhase = 'mid';
        else               detectedPhase = 'late';
        if (detectedPhase) phaseFromWeekInference = true;
      } else if (!isBroilerQuery) {
        // Generic poultry / ambiguous: use broad age cutoffs for chick phases
        if (wk <= 3)       detectedPhase = 'starter';
        else if (wk <= 6)  detectedPhase = 'grower';
        else if (wk <= 8)  detectedPhase = 'finisher';
        if (detectedPhase) phaseFromWeekInference = true;
      }
    }
  }

  // Production-type context from query — used to disambiguate entries that share short triggers
  const hasBreederCtx = /\bbreeder\b|\bparent stock\b|\bparent flock\b|\bps\b|\bgrandparent\b|\bgp\b/.test(q);
  const hasLayerCtx   = /\blayer\b|\blaying\b|\begg hen\b|\begg bird\b|\begg production\b/.test(q) && !hasBreederCtx;

  // Score every catalog entry — more trigger words matched = better match;
  // production-type bonuses break ties when the same short breed word appears in multiple entries
  let bestEntry = null;
  let bestScore = -Infinity;
  for (const entry of LIBRARY_CATALOG) {
    const matchedTriggers = entry.triggers.filter(t => q.includes(t.toLowerCase()));
    const baseScore = matchedTriggers.length;
    if (baseScore === 0) continue;

    // Bonus: longer/more specific matched triggers rank higher than short generic ones
    // (prevents "aa" alone from accidentally matching at the same level as "aa finisher")
    const specificityBonus = matchedTriggers.reduce((sum, t) => sum + Math.min(t.length / 8, 2), 0);

    let score = baseScore + specificityBonus;
    const sp = entry.species;
    const isBreederEntry = sp.includes("breeder");
    const isLayerEntry   = sp.endsWith("_layer");

    if (hasBreederCtx) {
      score += isBreederEntry ? 3 : -2;
    } else if (hasLayerCtx) {
      score += isLayerEntry ? 3 : (isBreederEntry ? -1 : 0);
    }

    if (score > bestScore) { bestScore = score; bestEntry = entry; }
  }

  const dailyIntakeG = detectDailyIntake(question);
  return { isLibraryQuery: true, phase: detectedPhase, phaseFromWeekInference, entry: bestEntry, dailyIntakeG };
}

// ─── Library loader ───────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    let raw = fs.readFileSync(filePath, "utf8");
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip BOM
    return JSON.parse(raw);
  } catch { return null; }
}

// Merge targets_override on top of base targets
function mergeOverride(base = {}, override = {}) {
  return { ...base, ...override };
}

// ─── Profile selector ────────────────────────────────────────────────────────

function selectProfiles(data, entry, phase) {
  if (!data) return [];
  const { structType, breedFilter, baseBreed } = entry;

  // ── SWINE: {phases: {phase_key: {energy, sid_amino_acids, minerals}}} ──
  if (structType === "swine_phases") {
    const phaseEntries = Object.entries(data.phases || {});
    if (!phaseEntries.length) return [];
    if (!phase) return phaseEntries.slice(0, 3).map(([k, v]) => flattenSwinePhase(k, v));
    const phAliases = PHASE_MAP[phase] || [phase];
    const matched = phaseEntries.filter(([k, v]) =>
      phAliases.some(kw => k.toLowerCase().includes(kw) || (v.label||"").toLowerCase().includes(kw))
    );
    return (matched.length ? matched : phaseEntries.slice(0, 2)).map(([k, v]) => flattenSwinePhase(k, v));
  }

  // ── EQUINE: dynamic, return profile metadata ──
  if (structType === "equine_dynamic") {
    const profiles = Object.entries(data.profiles || {});
    if (!phase) return profiles.slice(0, 4).map(([k, v]) => ({ label: v.class ? `${v.production} – ${v.class}` : k, _key: k, _dynamic: true, ...v }));
    // Match phase to production/class
    const matched = profiles.filter(([k, v]) => {
      const txt = `${k} ${v.production||""} ${v.class||""}`.toLowerCase();
      const phAliases = PHASE_MAP[phase] || [phase];
      return phAliases.some(kw => txt.includes(kw));
    });
    return (matched.length ? matched : profiles.slice(0, 3)).map(([k, v]) => ({ label: v.class ? `${v.production} – ${v.class}` : k, _key: k, _dynamic: true, ...v }));
  }

  // ── PROFILES WITH DIRECT TARGETS: {profiles: {key: {targets: {...}}}} ──
  if (structType === "profiles_targets") {
    const profiles = Object.entries(data.profiles || {});
    const phAliases = phase ? (PHASE_MAP[phase] || [phase]) : null;
    const bf = (breedFilter || "").toLowerCase();

    const matchesBreed = ([k, v]) => {
      const kl = k.toLowerCase();
      if (!bf || bf === "generic") {
        return kl.includes("generic") || (!kl.match(/(ross|cobb|hubbard|aa_|lohmann|hyline|dekalb|arbor|isa_brown|bovans|lsl_)/));
      }
      return kl.includes(bf) || (v.label||"").toLowerCase().includes(bf.replace(/_/g," "));
    };
    const matchesPhase = ([k, v]) => {
      if (!phAliases) return true;
      const kl = k.toLowerCase();
      const pl = (v.phase||"").toLowerCase();
      const ll = (v.label||"").toLowerCase();
      return phAliases.some(kw => kl.includes(kw) || pl.includes(kw) || ll.includes(kw));
    };

    // First: try to find profiles matching the EXACT requested breed
    const breedMatched = bf && bf !== "generic"
      ? profiles.filter(e => matchesBreed(e))
      : profiles.filter(e => matchesBreed(e));

    let matched = breedMatched.filter(matchesPhase);
    let usingGenericFallback = false;
    let genericFallbackReason = "";

    // If no breed-specific profiles found at all, fall back to generic/NRC2026 with a clear label
    if (!matched.length && bf && bf !== "generic" && !bf.startsWith("nrc2026")) {
      // Try "generic" profiles first, then NRC2026 as the reference standard
      matched = profiles.filter(e => (e[0].toLowerCase().includes("generic") || e[0].toLowerCase().includes("nrc2026")) && matchesPhase(e));
      usingGenericFallback = true;
      genericFallbackReason = `No breed-specific data found for "${bf.replace(/_/g," ")}" in the Nutrix library`;
    }
    if (!matched.length) matched = profiles.filter(matchesPhase);
    if (!matched.length) matched = profiles.filter(matchesBreed).slice(0, 3);
    if (!matched.length) { matched = profiles.slice(0, 3); usingGenericFallback = true; genericFallbackReason = "No matching phase found"; }

    // Resolve inheritance chain
    const resolveTargets = (v, depth = 0) => {
      if (depth > 5) return {};
      if (v.targets && Object.keys(v.targets).length) {
        return mergeOverride(v.targets, v.targets_override || {});
      }
      if (v.inherits) {
        const base = (data.profiles || {})[v.inherits] || {};
        const baseTargets = resolveTargets(base, depth + 1);
        return mergeOverride(baseTargets, v.targets_override || {});
      }
      return v.targets_override || {};
    };

    // Detect if a profile's data is purely inherited with no breed-specific overrides
    const isInheritedOnly = (v) => {
      if (!v.inherits) return false;
      const overrides = v.targets_override || {};
      return Object.keys(overrides).length === 0;
    };

    // Safety: if user asked for a specific phase and >1 profile survived the filter,
    // try to narrow to an exact v.phase match (catches cases where "finish" matches
    // a "wk5-finish" label as well as "finisher" label)
    if (matched.length > 1 && phAliases) {
      const primary = phAliases[0]; // first alias is always the canonical phase name
      const exact = matched.filter(([, v]) => (v.phase||"").toLowerCase() === primary);
      if (exact.length) matched = exact;
    }

    return matched.slice(0, 3).map(([k, v]) => {
      const inheritedOnly = isInheritedOnly(v);
      const isGenericProfile = k.toLowerCase().includes("generic");
      // Show notice when a specific breed was requested but we ended up showing generic or inherited-only data
      const showGenericNotice = (bf && bf !== "generic") && (usingGenericFallback || inheritedOnly);

      return {
        label: v.label || k,
        phase: v.phase,
        targets: resolveTargets(v),
        _key: k,
        _ref_intake_gpd: v.feed_intake?.recommended_gpd ?? null,
        _dataSource: isGenericProfile ? "generic"
          : inheritedOnly ? "inherited_no_overrides"
          : "breed_specific",
        _requestedBreed: showGenericNotice ? bf : null,
        _genericFallbackReason: showGenericNotice
          ? (genericFallbackReason || `${bf.replace(/_/g," ")} has no breed-specific overrides in this library version`)
          : null
      };
    });
  }

  // ── PROFILES WITH TARGETS_BY_PHASE: {profiles: {key: {targets_by_phase: {...}}}} ──
  if (structType === "profiles_phases") {
    const profiles = data.profiles || {};
    // Find the base profile (has targets_by_phase directly)
    const baseName = baseBreed || Object.keys(profiles).find(k => profiles[k].targets_by_phase);
    const baseProfile = profiles[baseName] || profiles[Object.keys(profiles).find(k => profiles[k].targets_by_phase)] || {};
    const tbp = baseProfile.targets_by_phase || {};

    // Apply breed override if requested
    let overrideTargets = {};
    if (breedFilter && breedFilter !== "generic" && profiles[breedFilter]?.targets_override) {
      overrideTargets = profiles[breedFilter].targets_override;
    }

    const phaseEntries = Object.entries(tbp);
    if (!phaseEntries.length) return [];

    const phAliases = phase ? (PHASE_MAP[phase] || [phase]) : null;
    let matched = phAliases
      ? phaseEntries.filter(([k]) => phAliases.some(kw => k.toLowerCase().includes(kw)))
      : phaseEntries.slice(0, 3);
    if (!matched.length) matched = phaseEntries.slice(0, 3);

    return matched.slice(0, 3).map(([k, targets]) => ({
      label: `${entry.label} – ${k.charAt(0).toUpperCase()+k.slice(1)}`,
      phase: k,
      targets: mergeOverride(targets, overrideTargets[k] || overrideTargets || {}),
      _key: k
    }));
  }

  // ── PROFILES WITH INHERITANCE: {profiles: {key: {inherits, targets_override}}} ──
  if (structType === "profiles_inherit_phases") {
    const profiles = data.profiles || {};
    // Find a base profile with targets_by_phase
    const baseName = Object.keys(profiles).find(k => profiles[k].targets_by_phase) || baseBreed;
    const baseProfile = profiles[baseName] || {};
    const tbp = baseProfile.targets_by_phase || {};

    // Get override for the requested breed
    const breedProfile = breedFilter ? profiles[breedFilter] : null;
    const overrides = breedProfile?.targets_override || {};

    const phaseEntries = Object.entries(tbp);
    if (!phaseEntries.length) {
      // No base found – try to return whatever data we have from all profiles
      return Object.entries(profiles).slice(0, 3).map(([k, v]) => ({
        label: k, targets: v.targets_override || {}, _key: k
      })).filter(p => Object.keys(p.targets).length > 0);
    }

    const phAliases = phase ? (PHASE_MAP[phase] || [phase]) : null;
    let matched = phAliases
      ? phaseEntries.filter(([k]) => phAliases.some(kw => k.toLowerCase().includes(kw)))
      : phaseEntries.slice(0, 3);
    if (!matched.length) matched = phaseEntries.slice(0, 3);

    return matched.slice(0, 3).map(([k, targets]) => ({
      label: `${entry.label} – ${k.charAt(0).toUpperCase()+k.slice(1)}`,
      phase: k,
      targets: mergeOverride(targets, overrides[k] || {}),
      _key: k
    }));
  }

  // ── PERFORMANCE LIBRARY: breed production/performance data ──
  if (structType === "performance_library") {
    if (!data) return [];
    const bf = entry.breedFilter || null;
    let breedData = null;
    if (!bf) {
      // Single-breed file (Holstein, Jersey) — the file IS the breed
      breedData = data;
    } else if (bf.includes("/")) {
      // Nested path: "category/breedKey"
      const [cat, breedKey] = bf.split("/");
      breedData = (data[cat] || {})[breedKey] || null;
    } else {
      // Flat key (donkey, mule)
      breedData = data[bf] || null;
    }
    if (!breedData) return [];
    return [{ label: entry.label, _breedData: breedData, _perfType: true }];
  }

  return [];
}

// Flatten swine phase (multi-section) into one targets object
function flattenSwinePhase(key, v) {
  const flat = {};
  if (v.energy) Object.assign(flat, v.energy);
  if (v.proximate) Object.assign(flat, v.proximate);
  if (v.sid_amino_acids) {
    const aa = v.sid_amino_acids;
    if (aa.lys_pct) flat.lys_pct = aa.lys_pct;
    if (aa.lys_ne_ratio_g_mcal) flat.lys_ne_ratio_g_mcal = aa.lys_ne_ratio_g_mcal;
    if (aa.lys_me_ratio_g_mcal) flat.lys_me_ratio_g_mcal = aa.lys_me_ratio_g_mcal;
  }
  // Flatten minerals — stringify any range objects so they don't become [object Object]
  if (v.minerals) {
    for (const [mk, mv] of Object.entries(v.minerals)) {
      if (mv !== null && typeof mv === 'object' && !Array.isArray(mv)) {
        if ('min' in mv && 'max' in mv) flat[mk] = `${mv.min}–${mv.max}`;
        else if ('gilts' in mv || 'sows' in mv) flat[mk] = mv.herd ?? mv.sows ?? Object.values(mv)[0];
        // else skip complex nested objects
      } else {
        flat[mk] = mv;
      }
    }
  }
  if (v.targets) Object.assign(flat, v.targets);
  // Derive SID Lys % from ratio if not explicitly given
  if (!flat.lys_pct && flat.lys_ne_ratio_g_mcal && flat.ne_kcal_kg) {
    flat.lys_pct = +(flat.lys_ne_ratio_g_mcal * flat.ne_kcal_kg / 10000).toFixed(2);
  }
  return {
    label: v.label || key,
    description: v.description || "",
    targets: flat,
    aa_ratios: v.sid_amino_acids?.ratios_to_lys || null,
    _key: key
  };
}

// ─── Intake adjustment (mirrors analyzeFormula.cjs logic exactly) ─────────────
// Applies ONLY to laying phases when actual intake differs from reference intake.
const LAYING_PHASES = new Set(['lay_early','lay_peak','lay_mid','lay_late','lay']);

function applyFeedIntakeAdjustment(targets, refGpd, actualGpd, phase) {
  if (!refGpd || !actualGpd || actualGpd === refGpd) return targets;
  if (!LAYING_PHASES.has(String(phase || '').toLowerCase())) return targets;
  const adjusted = {};
  for (const [k, v] of Object.entries(targets)) {
    if (typeof v !== 'number') { adjusted[k] = v; continue; }
    if (k === 'me_kcal_per_kg' || k === 'me_kcal_kg' || k === 'me_mj_per_kg') {
      if (actualGpd < 95) {
        adjusted[k] = k === 'me_mj_per_kg' ? +(2950 / 239.006).toFixed(3) : 2950;
      } else if (actualGpd > 120) {
        adjusted[k] = k === 'me_mj_per_kg' ? +(2650 / 239.006).toFixed(3) : 2650;
      } else {
        const sid_lys_ref = Number(targets['sid_lys_pct'] || 0);
        if (sid_lys_ref > 0 && v > 0) {
          const sid_lys_adj = sid_lys_ref * refGpd / actualGpd;
          const ref_ratio = sid_lys_ref * 10 / v;
          const me_adj = Math.round(sid_lys_adj * 10 / ref_ratio);
          adjusted[k] = Math.min(2950, Math.max(2650, me_adj));
        } else {
          adjusted[k] = v;
        }
      }
    } else {
      adjusted[k] = Math.round((v * refGpd / actualGpd) * 1000) / 1000;
    }
  }
  return adjusted;
}

// ─── Formatter ────────────────────────────────────────────────────────────────

function formatRequirementsAnswer(profiles, title, dailyIntakeG = null) {
  if (!profiles || !profiles.length) return null;
  const lines = [`**${title}**\n`];
  if (dailyIntakeG) lines.push(`*Based on ${dailyIntakeG} g/hen/day feed intake*\n`);

  for (const prof of profiles) {
    const heading = prof.label || prof._key || "Profile";
    lines.push(`### ${heading}`);

    // Data quality label in the profile heading (brief, since mandatoryNotice already has the full warning)
    if (prof._genericFallbackReason && !prof._key?.toLowerCase().includes("generic")) {
      const breedDisplay = (prof._requestedBreed || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      lines.push(`*Showing generic commercial targets (no ${breedDisplay}-specific data in library)*`);
      lines.push("");
    }
    if (prof.description) lines.push(`*${prof.description}*`);

    if (prof._dynamic) {
      // Equine dynamic profiles — no static targets
      lines.push(`• Class: ${prof.class || "—"}   Production: ${prof.production || "—"}   BW: ${prof.body_weight_kg_default ? prof.body_weight_kg_default+"kg" : "dynamic"}   Standard: ${prof.engine || "NRC 2007"}`);
      lines.push(`*(Requirements are dynamically calculated by the NRC 2007 engine based on body weight, workload, and reproductive status)*`);
    } else {
      // Apply feed-intake adjustment when actual intake differs from library reference
      const rawTgt = prof.targets || {};
      const tgt = (dailyIntakeG && prof._ref_intake_gpd && dailyIntakeG !== prof._ref_intake_gpd)
        ? applyFeedIntakeAdjustment(rawTgt, prof._ref_intake_gpd, dailyIntakeG, prof.phase)
        : rawTgt;
      if (dailyIntakeG && prof._ref_intake_gpd && dailyIntakeG !== prof._ref_intake_gpd) {
        lines.push(`*Library reference: ${prof._ref_intake_gpd} g/day. Values below are adjusted for ${dailyIntakeG} g/day actual intake to match formulation workspace targets.*`);
      }
      const ENG   = ["me_kcal_per_kg","me_kcal_kg","ne_kcal_kg","me_mj_per_kg","ne_kcal_per_kg",
                     "de_mcal_per_kg","de_mj_per_kg"];
      const PROX  = ["cp_pct","cp","ee_pct","cf_pct"];
      const MIN   = ["ca_pct","ca","calcium_pct","avp_pct","avp","avail_p_pct","sttd_p_pct","total_p_pct","p_pct",
                     "na_pct","na","sodium_pct","k_pct","cl_pct","mg_pct","s_pct","deb_meq_per_kg","chloride_pct",
                     "sttd_p_ne_ratio_g_mcal","sttd_p_me_ratio_g_mcal","avail_p_ne_ratio_g_mcal","avail_p_me_ratio_g_mcal",
                     "ca_to_p_ratio","ca_to_p_ratio_analyzed","ca_to_p_ratio_no_phytase","sttd_p_ne_ratio_g_mcal_herd",
                     "ndf_min_pct","linoleic_acid_pct","lys_min_g_day"];
      const TRC   = ["cu_ppm","zn_ppm","mn_ppm","fe_ppm","se_ppm","i_ppm","co_ppm"];
      const AA    = ["sid_lys_pct","lys_pct","sid_met_pct","met_pct","sid_metcys_pct","sid_thr_pct","thr_pct",
                     "sid_trp_pct","trp_pct","sid_arg_pct","arg_pct","sid_val_pct","sid_ile_pct","sid_leu_pct",
                     "lys_ne_ratio_g_mcal","lys_me_ratio_g_mcal"];
      const VIT   = ["vit_a_iu_per_kg","vit_d_iu_per_kg","vit_e_iu_per_kg","biotin_ppm"];
      const FIBER = ["ndf_pct_min","adf_pct_min","starch_pct_max","nsc_pct_max"];

      const grouped = {};
      for (const [k,v] of Object.entries(tgt)) {
        if (v == null || v === "") continue;
        let grp = "Other";
        if (ENG.includes(k) || PROX.includes(k)) grp = "Energy & Protein";
        else if (MIN.includes(k))   grp = "Minerals";
        else if (TRC.includes(k))   grp = "Trace Minerals";
        else if (AA.includes(k))    grp = "Amino Acids";
        else if (VIT.includes(k))   grp = "Vitamins";
        else if (FIBER.includes(k)) grp = "Fiber / NSC";
        const vStr = (v !== null && typeof v === 'object') ? (('min' in v && 'max' in v) ? `${v.min}–${v.max}` : JSON.stringify(v)) : v;
        (grouped[grp] = grouped[grp]||[]).push(`  • ${nutrientLabel(k)}: ${vStr}`);
      }

      for (const grp of ["Energy & Protein","Minerals","Trace Minerals","Amino Acids","Vitamins","Fiber / NSC","Other"]) {
        if (grouped[grp]?.length) {
          lines.push(`**${grp}**`);
          lines.push(...grouped[grp]);
        }
      }

      if (prof.aa_ratios) {
        lines.push("**AA Ratios to Lys (SID %)**");
        for (const [aa,ratio] of Object.entries(prof.aa_ratios)) {
          lines.push(`  • ${aa.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase())}: ${ratio}%`);
        }
      }

      if (!Object.keys(tgt).length && !prof._dynamic) {
        lines.push(`*(No static targets available for this profile — consult breed management guide)*`);
      }

      // ── Daily intake calculation ──────────────────────────────────────────
      if (dailyIntakeG && Object.keys(tgt).length) {
        const intG = dailyIntakeG;
        // Only calculate for % and kcal/kg nutrients that make sense on a per-day basis
        const PCT_KEYS = [
          "cp_pct","ca_pct","calcium_pct","avp_pct","avail_p_pct","na_pct","sodium_pct",
          "k_pct","cl_pct","sid_lys_pct","lys_pct","sid_met_pct","met_pct",
          "sid_metcys_pct","sid_thr_pct","thr_pct","sid_trp_pct","trp_pct",
          "sid_arg_pct","arg_pct","sid_val_pct","sid_ile_pct","sid_leu_pct"
        ];
        const ENERGY_KEYS = ["me_kcal_per_kg","me_kcal_kg","ne_kcal_kg"];

        const intakeRows = [];
        for (const k of PCT_KEYS) {
          if (tgt[k] == null) continue;
          const gPerDay = (tgt[k] / 100) * intG;
          intakeRows.push(`  • ${nutrientLabel(k)}: ${tgt[k]}% → **${gPerDay.toFixed(3)} g/day**`);
        }
        for (const k of ENERGY_KEYS) {
          if (tgt[k] == null) continue;
          const kcalPerDay = (tgt[k] / 1000) * intG;
          intakeRows.push(`  • ${nutrientLabel(k)}: ${tgt[k]} kcal/kg → **${kcalPerDay.toFixed(1)} kcal/day**`);
        }

        if (intakeRows.length) {
          lines.push(`**Daily Nutrient Intake at ${intG} g/day feed**`);
          lines.push(...intakeRows);
        }
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ─── Performance library formatter ───────────────────────────────────────────

function formatPerformanceAnswer(breedData, label) {
  if (!breedData) return null;
  const lines = [`**${label} – Breed Performance Library (Nutrix)**\n`];
  const meta = breedData._meta || {};

  if (meta.breed || meta.common_name) lines.push(`**Breed:** ${meta.common_name || meta.breed}`);
  if (meta.origin) lines.push(`**Origin:** ${meta.origin}`);
  if (meta.type) lines.push(`**Type:** ${String(meta.type).replace(/_/g," ")}`);
  if (meta.mature_bw_kg) lines.push(`**Mature BW:** ${meta.mature_bw_kg} kg`);
  if (meta.mature_weight_buck_kg || meta.mature_weight_doe_kg) {
    const bk = meta.mature_weight_buck_kg ? `Buck: ${meta.mature_weight_buck_kg} kg` : "";
    const dk = meta.mature_weight_doe_kg  ? `Doe: ${meta.mature_weight_doe_kg} kg`   : "";
    lines.push(`**Mature Weight:** ${[bk,dk].filter(Boolean).join("  |  ")}`);
  }
  if (meta.carcass_yield_pct) lines.push(`**Carcass Yield:** ${meta.carcass_yield_pct}%`);
  if (meta.kidding_rate_pct)  lines.push(`**Kidding Rate:** ${meta.kidding_rate_pct}%`);
  if (meta.birth_wt_kg) lines.push(`**Birth Weight:** ${meta.birth_wt_kg} kg`);
  if (meta.weaning_wt_kg_205d) lines.push(`**Weaning Weight (205d):** ${meta.weaning_wt_kg_205d} kg`);
  if (meta.note) lines.push(`**Note:** ${meta.note}`);
  if (meta.source) lines.push(`**Source:** ${String(meta.source).substring(0,200)}${String(meta.source).length>200?"...":""}`);
  lines.push("");

  // Annual / lactation production targets
  if (breedData.annual_targets && Object.keys(breedData.annual_targets).length) {
    lines.push(`**Annual Production Targets**`);
    for (const [k, v] of Object.entries(breedData.annual_targets)) {
      const lbl = k.replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase());
      lines.push(`  • ${lbl}: ${v}`);
    }
    lines.push("");
  }

  // Growth / production phases
  if (breedData.phases && Object.keys(breedData.phases).length) {
    lines.push(`**Production Phases**`);
    for (const [phaseName, ph] of Object.entries(breedData.phases)) {
      if (typeof ph !== 'object' || ph === null) continue;
      const pLbl = ph.label || phaseName.replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase());
      lines.push(`  **${pLbl}**`);
      const parts = [];
      if (ph.age_weeks)          parts.push(`Age: ${ph.age_weeks} wks`);
      if (ph.days)               parts.push(`Duration: ${ph.days} days`);
      if (ph.weeks)              parts.push(`Duration: ${ph.weeks} wks`);
      if (ph.months)             parts.push(`Duration: ${ph.months} mo`);
      if (ph.weight_range_kg)    parts.push(`BW: ${ph.weight_range_kg} kg`);
      if (ph.target_bw_kg)       parts.push(`Target BW: ${ph.target_bw_kg} kg`);
      if (ph.target_bw_end_kg)   parts.push(`End BW: ${ph.target_bw_end_kg} kg`);
      if (ph.target_adg_kg_day)  parts.push(`ADG: ${ph.target_adg_kg_day} kg/day`);
      if (ph.adg_g_day)          parts.push(ph.adg_range_g_day ? `ADG: ${ph.adg_g_day} g/day (range: ${ph.adg_range_g_day})` : `ADG: ${ph.adg_g_day} g/day`);
      if (ph.daily_gain_g)       parts.push(`Daily Gain: ${ph.daily_gain_g} g/day`);
      if (ph.adfi_kg_d || ph.target_adfi_kg_d) parts.push(`ADFI: ${ph.adfi_kg_d || ph.target_adfi_kg_d} kg/day`);
      if (ph.feed_kg_dm)         parts.push(`Feed DM: ${ph.feed_kg_dm} kg/day`);
      if (ph.fcr)                parts.push(ph.fcr_range ? `FCR: ${ph.fcr} (range: ${ph.fcr_range})` : `FCR: ${ph.fcr}`);
      if (ph.target_fcr)         parts.push(`Target FCR: ${ph.target_fcr}`);
      // Market targets fields
      if (ph.market_wt_kg_range) parts.push(`Market BW: ${ph.market_wt_kg_range} kg`);
      if (ph.carcass_yield_pct)  parts.push(`Carcass yield: ${ph.carcass_yield_pct}%`);
      if (ph.dressing_pct_range) parts.push(`Dressing: ${ph.dressing_pct_range}%`);
      if (ph.age_at_market_weeks_range) parts.push(`Age at market: ${ph.age_at_market_weeks_range} wks`);
      if (ph.kidding_rate_pct)   parts.push(`Kidding rate: ${ph.kidding_rate_pct}%`);
      if (ph.litter_size_avg)    parts.push(`Litter size: ${ph.litter_size_avg}`);
      if (ph.pre_wean_mortality_pct_max) parts.push(`Pre-wean mortality: ≤${ph.pre_wean_mortality_pct_max}%`);
      if (parts.length) lines.push(`    ${parts.join("  |  ")}`);
      if (ph.note || ph.notes) lines.push(`    ℹ ${ph.note || ph.notes}`);
    }
    lines.push("");
  }

  // Growth / lactation / production performance curve
  const curveArr = breedData.curve || breedData.lactation_curve || breedData.growth_curve;
  if (Array.isArray(curveArr) && curveArr.length) {
    // Detect curve type: meat-growth (has body_wt_kg or daily_gain_g) vs lactation (has milk_kg_day)
    const isMeatGrowth = curveArr.some(pt => pt.body_wt_kg != null || pt.daily_gain_g != null);
    const isLactation  = curveArr.some(pt => pt.milk_kg_day != null);

    if (isMeatGrowth && !isLactation) {
      // Meat-growth curve: show as a table (week | BW | ADG | Feed DM | FCR | Mortality)
      lines.push(`**Growth Curve**`);
      lines.push(`  Age (wk) | BW (kg) | ADG (g/d) | Feed DM (kg/d) | FCR  | Mort %`);
      lines.push(`  ---------|---------|-----------|----------------|------|-------`);
      for (const pt of curveArr) {
        const wk   = String(pt.week ?? pt.wk ?? "?").padStart(3);
        const bw   = pt.body_wt_kg != null ? String(pt.body_wt_kg).padEnd(7) : "  —   ";
        const adg  = pt.daily_gain_g != null ? String(pt.daily_gain_g).padEnd(9) : "   —     ";
        const feed = pt.feed_kg_dm != null ? String(pt.feed_kg_dm).padEnd(14) : "     —         ";
        const fcr  = pt.fcr != null ? String(pt.fcr).padEnd(4) : " —  ";
        const mort = pt.mortality_pct_max != null ? pt.mortality_pct_max : "—";
        lines.push(`  ${wk}      | ${bw} | ${adg} | ${feed} | ${fcr} | ${mort}`);
      }
      lines.push("");
    } else {
      // Lactation / dairy / other curves — key-point format
      const keyPoints = [1,4,8,12,16,24,36,48];
      const shown = curveArr.filter(pt => keyPoints.includes(pt.week ?? pt.wol ?? pt.wk ?? pt.month));
      const pts = shown.length ? shown : curveArr.slice(0,6);
      if (pts.length) {
        const ptLines = [];
        for (const pt of pts) {
          const wk = pt.week ?? pt.wol ?? pt.wk ?? pt.month ?? "?";
          const parts = [];
          if (pt.milk_kg_day != null)         parts.push(`Milk: ${pt.milk_kg_day} kg/d`);
          if (pt.fat_pct != null)             parts.push(`Fat: ${pt.fat_pct}%`);
          if (pt.protein_pct != null)         parts.push(`Protein: ${pt.protein_pct}%`);
          if (pt.bcs_min != null)             parts.push(`BCS min: ${pt.bcs_min}`);
          if (pt.adg_kg_day != null)          parts.push(`ADG: ${pt.adg_kg_day} kg/d`);
          if (pt.body_wt_kg != null)          parts.push(`BW: ${pt.body_wt_kg} kg`);
          if (pt.bw_kg != null)               parts.push(`BW: ${pt.bw_kg} kg`);
          if (pt.daily_gain_g != null)        parts.push(`ADG: ${pt.daily_gain_g} g/d`);
          if (pt.feed_kg_dm != null)          parts.push(`Feed DM: ${pt.feed_kg_dm} kg/d`);
          if (pt.fcr != null)                 parts.push(`FCR: ${pt.fcr}`);
          if (pt.growth_rate_kg_day != null)  parts.push(`Growth: ${pt.growth_rate_kg_day} kg/d`);
          if (pt.work_level != null)          parts.push(`Work: ${pt.work_level}`);
          if (parts.length) ptLines.push(`  • Wk/Mo ${wk}: ${parts.join(", ")}`);
        }
        if (ptLines.length) {
          lines.push(`**Performance Curve (Key Points)**`);
          lines.push(...ptLines);
          lines.push("");
        }
      }
    }
  }

  // Adult workload / reproductive standards (donkey/mule)
  if (breedData.adult_workload_standards) {
    lines.push(`**Workload Standards**`);
    for (const [k, v] of Object.entries(breedData.adult_workload_standards)) {
      lines.push(`  • ${k.replace(/_/g," ")}: ${JSON.stringify(v)}`);
    }
    lines.push("");
  }
  if (breedData.reproductive_standards) {
    lines.push(`**Reproductive Standards**`);
    for (const [k, v] of Object.entries(breedData.reproductive_standards)) {
      lines.push(`  • ${k.replace(/_/g," ")}: ${v}`);
    }
    lines.push("");
  }

  // ── Aquaculture key metrics ────────────────────────────────────────────────
  if (meta.harvest_weight_g || meta.fcr_target || meta.sgr_pct_day || meta.survival_pct || meta.cycle_days) {
    lines.push(`**Production Targets**`);
    if (meta.cycle_days) lines.push(`  • Cycle length: ${meta.cycle_days} days`);
    if (meta.harvest_weight_g) lines.push(`  • Harvest weight: ${meta.harvest_weight_g} g`);
    if (meta.fcr_target) lines.push(`  • Target FCR: ${meta.fcr_target}`);
    if (meta.sgr_pct_day) lines.push(`  • SGR: ${meta.sgr_pct_day}%/day`);
    if (meta.survival_pct) lines.push(`  • Survival: ${meta.survival_pct}%`);
    if (meta.stocking_density_per_m2) lines.push(`  • Stocking density: ${meta.stocking_density_per_m2}/m²`);
    if (meta.system) lines.push(`  • System: ${meta.system}`);
    lines.push("");
  }

  // Aquaculture growth curve (day-based) ──────────────────────────────────
  if (Array.isArray(curveArr) && curveArr.length && curveArr[0]?.day !== undefined) {
    lines.push(`**Growth Curve (Age → Weight)**`);
    const pts = curveArr.filter((_, i) => i % 2 === 0 || i === curveArr.length - 1);
    for (const pt of pts) {
      const parts = [`BW: ${pt.body_wt_g} g`];
      if (pt.sgr_pct_day != null) parts.push(`SGR: ${pt.sgr_pct_day}%/d`);
      if (pt.fcr != null) parts.push(`FCR: ${pt.fcr}`);
      if (pt.survival_pct != null) parts.push(`Survival: ${pt.survival_pct}%`);
      lines.push(`  • Day ${pt.day}: ${parts.join(", ")}`);
    }
    lines.push("");
  }

  // ── Camelid — milk performance ─────────────────────────────────────────────
  if (breedData.milk_performance) {
    lines.push(`**Milk Performance**`);
    const mp = breedData.milk_performance;
    if (mp.total_lactation_L) lines.push(`  • Total lactation yield: ${mp.total_lactation_L} L`);
    if (mp.dairy_breed_potential_L) lines.push(`  • Dairy breed potential: ${mp.dairy_breed_potential_L} L`);
    if (mp.peak_yield_L_day) lines.push(`  • Peak yield: ${mp.peak_yield_L_day} L/day`);
    if (mp.peak_week) lines.push(`  • Peak at: Week ${mp.peak_week}`);
    if (mp.fat_pct) lines.push(`  • Fat: ${mp.fat_pct}%`);
    if (mp.protein_pct) lines.push(`  • Protein: ${mp.protein_pct}%`);
    lines.push("");
  }

  // ── Camelid — fiber performance ────────────────────────────────────────────
  if (breedData.fiber_performance) {
    lines.push(`**Fiber / Fleece Performance**`);
    const fp = breedData.fiber_performance;
    if (fp.annual_fleece_kg_greasy) lines.push(`  • Annual fleece: ${fp.annual_fleece_kg_greasy} kg (greasy)`);
    if (fp.annual_wool_g) lines.push(`  • Annual wool: ${fp.annual_wool_g} g`);
    if (fp.fiber_diameter_micron) lines.push(`  • Fiber diameter: ${fp.fiber_diameter_micron} µm`);
    if (fp.staple_length_cm) lines.push(`  • Staple length: ${fp.staple_length_cm} cm`);
    if (fp.shearing_every_weeks) lines.push(`  • Shearing interval: every ${fp.shearing_every_weeks} weeks`);
    if (fp.lock_style) lines.push(`  • Lock style: ${fp.lock_style.replace(/_/g," ")}`);
    lines.push("");
  }

  // ── Camelid — draft / pack performance ────────────────────────────────────
  if (breedData.draft_performance) {
    lines.push(`**Draft Performance**`);
    const dp = breedData.draft_performance;
    if (dp.load_kg) lines.push(`  • Load: ${dp.load_kg} kg`);
    if (dp.speed_km_h) lines.push(`  • Speed: ${dp.speed_km_h} km/h`);
    if (dp.daily_distance_km) lines.push(`  • Daily distance: ${dp.daily_distance_km} km`);
    if (dp.max_distance_km_day) lines.push(`  • Max distance: ${dp.max_distance_km_day} km/day`);
    lines.push("");
  }
  if (breedData.pack_performance) {
    lines.push(`**Pack / Work Performance**`);
    const pp = breedData.pack_performance;
    if (pp.recommended_load_kg) lines.push(`  • Recommended load: ${pp.recommended_load_kg} kg`);
    if (pp.max_load_kg) lines.push(`  • Max load: ${pp.max_load_kg} kg`);
    if (pp.daily_trek_km) lines.push(`  • Daily trek: ${pp.daily_trek_km} km`);
    if (pp.training_age_months) lines.push(`  • Training age: ${pp.training_age_months} months`);
    lines.push("");
  }

  // ── Rabbit reproductive performance ────────────────────────────────────────
  if (breedData.reproductive_performance) {
    lines.push(`**Reproductive Performance**`);
    const rp = breedData.reproductive_performance;
    for (const [k, v] of Object.entries(rp)) {
      lines.push(`  • ${k.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase())}: ${v}`);
    }
    lines.push("");
  }

  // ── Poultry layer — production summary + full weekly curve ──────────────────
  const _isLayerCurve = Array.isArray(curveArr) && curveArr.length &&
    curveArr.some(pt => pt.egg_prod_pct != null || pt.egg_wt_g != null);
  if (_isLayerCurve) {
    // Compute key production statistics from the curve data
    const _layerValid = curveArr.filter(pt => pt.egg_prod_pct != null && pt.egg_prod_pct > 0);
    const _peakPt     = _layerValid.reduce((b, pt) => pt.egg_prod_pct > (b?.egg_prod_pct || 0) ? pt : b, null);
    const _hh50Pt     = _layerValid.find(pt => pt.egg_prod_pct >= 50);
    const _firstPt    = curveArr[0];
    const _lastPt     = curveArr[curveArr.length - 1];
    // Estimate cumulative eggs (trapezoidal integration of HDEP% across weeks)
    let _cumEggs = 0;
    for (let i = 0; i < curveArr.length - 1; i++) {
      const wkA = curveArr[i].week ?? 0, wkB = curveArr[i+1].week ?? 0;
      const pA  = curveArr[i].egg_prod_pct   ?? 0;
      const pB  = curveArr[i+1].egg_prod_pct ?? 0;
      _cumEggs += ((pA + pB) / 2 / 100) * (wkB - wkA) * 7;
    }
    lines.push(`**Layer Production Summary (Hen House)**`);
    if (_peakPt)       lines.push(`  • Peak HDEP: ${_peakPt.egg_prod_pct}% (Week ${_peakPt.week})`);
    if (_hh50Pt)       lines.push(`  • HH50 (50% production): Week ${_hh50Pt.week}`);
    if (_cumEggs > 0)  lines.push(`  • Estimated eggs to Week ${_lastPt.week ?? '?'}: ${Math.round(_cumEggs)} eggs/bird`);
    if (_peakPt?.egg_wt_g) lines.push(`  • Egg weight at peak: ${_peakPt.egg_wt_g} g`);
    if (_peakPt?.fcr)  lines.push(`  • FCR at peak: ${_peakPt.fcr}`);
    if (_peakPt?.feed_per_bird_g) lines.push(`  • Feed at peak: ${_peakPt.feed_per_bird_g} g/bird/day`);
    if (_firstPt?.body_wt_g) lines.push(`  • BW at housing (Wk ${_firstPt.week}): ${_firstPt.body_wt_g} g`);
    if (_lastPt?.body_wt_g && _lastPt !== _firstPt) lines.push(`  • BW at end of cycle (Wk ${_lastPt.week}): ${_lastPt.body_wt_g} g`);
    if (meta.source) {
      const summaryMatch = meta.source.match(/[Ss]ummary:\s*([^.]+(?:\.[^.]+)?)/);
      if (summaryMatch) lines.push(`  • Guide summary: ${summaryMatch[1].trim()}`);
    }
    lines.push("");

    lines.push(`**Weekly Production Curve**`);
    lines.push(`  Wk | HDEP% | Egg Wt | BW(g) | Feed g/d | FCR | Max Mort%`);
    lines.push(`  ---|-------|--------|-------|----------|-----|----------`);
    for (const pt of curveArr) {
      const wk   = String(pt.week ?? '?').padStart(3);
      const ep   = pt.egg_prod_pct != null ? String(pt.egg_prod_pct).padStart(5) : '    -';
      const ew   = pt.egg_wt_g     != null ? String(pt.egg_wt_g).padStart(6)     : '     -';
      const bw   = pt.body_wt_g    != null ? String(pt.body_wt_g).padStart(5)   : '    -';
      const fd   = pt.feed_per_bird_g != null ? String(pt.feed_per_bird_g).padStart(8) : '       -';
      const fcr  = pt.fcr           != null ? String(pt.fcr).padStart(5)         : '    -';
      const mort = pt.mortality_pct_max != null ? String(pt.mortality_pct_max).padStart(9) : '        -';
      lines.push(`  ${wk} | ${ep}% | ${ew} g | ${bw}  | ${fd}  | ${fcr} | ${mort}%`);
    }
    lines.push("");
  }

  // ── Swine gilt development — phases, service targets, first parity, checkpoints ──
  if (breedData.development_phases) {
    lines.push(`**Gilt Development Phases**`);
    lines.push(`  Phase          | Weight Range | ADG g/d | ADFI kg/d | FCR`);
    lines.push(`  ---------------|-------------|---------|-----------|----`);
    for (const [phaseName, ph] of Object.entries(breedData.development_phases)) {
      if (phaseName === '_meta' || typeof ph !== 'object') continue;
      const pLbl = phaseName.replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase()).padEnd(15);
      const wr   = ph.weight_range_kg ? `${ph.weight_range_kg} kg`.padEnd(11) : '           ';
      const adg  = String(ph.target_adg_g_d ?? '-').padStart(7);
      const adfi = String(ph.target_adfi_kg_d ?? '-').padStart(9);
      const fcr  = String(ph.target_fcr ?? '-').padStart(4);
      lines.push(`  ${pLbl} | ${wr} | ${adg} | ${adfi} | ${fcr}`);
    }
    lines.push("");
  }
  if (breedData.service_targets) {
    lines.push(`**First Service Targets**`);
    const st = breedData.service_targets;
    if (st.age_days_range)              lines.push(`  • Age at first service: ${st.age_days_range} days`);
    if (st.weight_kg_range)             lines.push(`  • Weight at service: ${st.weight_kg_range} kg`);
    if (st.p2_backfat_mm_range)         lines.push(`  • P2 backfat: ${st.p2_backfat_mm_range} mm`);
    if (st.heat_cycles_before_service)  lines.push(`  • Mate on: ${st.heat_cycles_before_service} heat`);
    if (st.puberty_detection_age_days)  lines.push(`  • Boar exposure begins: Day ${st.puberty_detection_age_days}`);
    if (st.estrus_response_minimum_pct) lines.push(`  • Minimum estrus response (selection cutoff): ≥${st.estrus_response_minimum_pct}%`);
    if (st.notes)                       lines.push(`  • Note: ${st.notes}`);
    lines.push("");
  }
  if (breedData.first_parity_targets) {
    lines.push(`**First Parity Targets**`);
    const fp = breedData.first_parity_targets;
    if (fp.total_born)                    lines.push(`  • Total born: ${fp.total_born}`);
    if (fp.born_alive)                    lines.push(`  • Born alive: ${fp.born_alive}`);
    if (fp.stillborn_pct)                 lines.push(`  • Stillborn: ${fp.stillborn_pct}%`);
    if (fp.weaning_age_days)              lines.push(`  • Weaning age: ${fp.weaning_age_days} days`);
    if (fp.litter_weight_at_weaning_kg)   lines.push(`  • Litter weight at weaning: ${fp.litter_weight_at_weaning_kg} kg`);
    if (fp.wean_to_estrus_interval_days)  lines.push(`  • Wean-to-estrus interval: ${fp.wean_to_estrus_interval_days} days`);
    if (fp.conception_rate_pct)           lines.push(`  • Conception rate: ${fp.conception_rate_pct}%`);
    if (fp.notes)                         lines.push(`  • Note: ${fp.notes}`);
    lines.push("");
  }
  if (Array.isArray(breedData.growth_checkpoints) && breedData.growth_checkpoints.length) {
    lines.push(`**Growth Checkpoints**`);
    lines.push(`  Age (d) | Target BW | Range   | Note`);
    lines.push(`  --------|-----------|---------|-----`);
    for (const pt of breedData.growth_checkpoints) {
      const age  = String(pt.age_days).padStart(7);
      const bw   = pt.target_bw_kg ? `${pt.target_bw_kg} kg`.padEnd(9) : '-        ';
      const rng  = pt.bw_std_kg ? `±${pt.bw_std_kg} kg`.padEnd(7) : '-      ';
      const note = pt.note || '';
      lines.push(`  ${age} | ${bw} | ${rng} | ${note}`);
    }
    lines.push("");
  }

  // ── Camelid / companion growth curve (month or week-based, no 'day' field) ──
  if (!_isLayerCurve && Array.isArray(curveArr) && curveArr.length && curveArr[0]?.day === undefined) {
    const hasMonth = curveArr[0]?.month !== undefined;
    const hasWeek  = curveArr[0]?.week  !== undefined;
    if (hasMonth || hasWeek) {
      lines.push(`**Growth Curve (Key Checkpoints)**`);
      for (const pt of curveArr) {
        const unit  = hasMonth ? `Month ${pt.month}` : `Week ${pt.week}`;
        const bw    = pt.body_wt_kg != null ? `BW: ${pt.body_wt_kg} kg` : pt.body_wt_g != null ? `BW: ${pt.body_wt_g} g` : null;
        const adg   = pt.adg_g_day  != null ? `ADG: ${pt.adg_g_day} g/d` : null;
        const fcr   = pt.fcr        != null ? `FCR: ${pt.fcr}` : null;
        const note  = pt.notes || null;
        const parts = [bw, adg, fcr, note].filter(Boolean);
        if (parts.length) lines.push(`  • ${unit}: ${parts.join(", ")}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ─── Multi-intake comparison formatter ───────────────────────────────────────
// Generates a side-by-side daily nutrient intake table for multiple feed intake values.
function formatMultiIntakeComparison(profiles, title, intakes) {
  if (!profiles || !profiles.length || !intakes.length) return null;
  const prof = profiles[0];
  const tgt = prof.targets || {};
  if (!Object.keys(tgt).length) return null;

  const PCT_KEYS = [
    "cp_pct","ca_pct","avp_pct","total_p_pct","na_pct","k_pct","cl_pct","mg_pct",
    "sid_lys_pct","lys_pct","sid_met_pct","met_pct","sid_metcys_pct",
    "sid_thr_pct","thr_pct","sid_trp_pct","sid_arg_pct"
  ];
  const ENERGY_KEYS = ["me_kcal_per_kg","me_kcal_kg"];

  const lines = [`**${title}**`, `*Daily nutrient intake comparison at ${intakes.join(" / ")} g/hen/day*`, ""];

  // Header row
  const header = `| Nutrient | Diet % |${intakes.map(i => ` ${i} g/day |`).join("")}`;
  const divider = `|---|---|${intakes.map(() => "---|").join("")}`;
  lines.push(header, divider);

  for (const k of PCT_KEYS) {
    if (tgt[k] == null) continue;
    const row = `| ${nutrientLabel(k)} | ${tgt[k]}% |${intakes.map(i => ` ${((tgt[k]/100)*i).toFixed(3)} g |`).join("")}`;
    lines.push(row);
  }
  for (const k of ENERGY_KEYS) {
    if (tgt[k] == null) continue;
    const row = `| ${nutrientLabel(k)} | ${tgt[k]} kcal/kg |${intakes.map(i => ` ${((tgt[k]/1000)*i).toFixed(1)} kcal |`).join("")}`;
    lines.push(row);
  }
  lines.push("");
  return lines.join("\n");
}

// ─── Static fallback text for species without library files ──────────────────

const NO_LIBRARY_FALLBACKS = {
  dairy: `**Dairy Cow Nutrient Requirements**\n\nNutrix has a dairy performance library (Holstein, Jersey, Brown Swiss, Ayrshire, Guernsey, Milking Shorthorn, Sahiwal, Gir) tracking production curves and annual targets. Nutrient formulation requirements are not yet wired as a queryable feed formulation library.\n\nTypical early lactation Holstein (NASEM 2021):\n• NEL: 1.70–1.75 Mcal/kg DM\n• CP: 17–18% DM (RDP ≈10–11%, RUP ≈6–7%)\n• Ca: 0.65%  P: 0.40%  Mg: 0.30% DM\n• SID Lys: 7.2% of MP  SID Met: 2.5% of MP\n• NDF ≥28% DM, ADF ≥19% DM\n\nKey reference: NASEM 2021 / Cornell CNCPS. For exact requirements, use NASEM model with herd's milk yield, BW, and stage.`,

  beef: `**Beef Cattle Nutrient Requirements**\n\nNutrix has a beef performance library (Angus, Hereford, Simmental, Charolais, Brahman, Nelore, Wagyu, Limousin, Shorthorn) tracking growth targets. Feed formulation nutrient requirements are not yet queryable here.\n\nTypical finishing steer (400–500 kg):\n• NEg: 1.10–1.20 Mcal/kg DM\n• NEm: 1.55–1.65 Mcal/kg DM\n• CP: 12–13% DM  Ca: 0.3–0.4%  P: 0.2–0.3%\n• TDN: ~72–76% DM\n\nKey reference: NRC Nutrient Requirements of Beef Cattle (2016). Requirements vary by breed, frame size, sex, and target ADG.`,

  sheep: `**Sheep Nutrient Requirements**\n\nNutrix has a sheep performance library (Merino, Suffolk, Texel, Dorper, Awassi, Kajli, Nali) with breed growth benchmarks. Feed formulation nutrient requirements are not yet directly queryable.\n\nTypical finishing lamb (30–40 kg, ADG 250 g/day):\n• ME: 12–13 MJ/kg DM\n• CP: 16–18% DM  Ca: 0.6%  P: 0.3%\n• SID Lys: ≈0.85% DM  SID Met: ≈0.30% DM\n\nKey references: NRC Small Ruminants (2007), AFRC (1993). Breeding ewes and rams have distinct requirements by stage.`,

  goat: `**Goat Nutrient Requirements**\n\nNutrix has a goat library with breeds across meat (Boer, Kalahari, Black Bengal, Osmanabadi), dairy (Saanen, Alpine, Nubian, Toggenburg, Lamancha), dual-purpose (Beetal, Barbari), and fiber (Angora, Cashmere) types. Feed formulation nutrient requirements are not yet directly queryable here.\n\nTypical dairy goat peak lactation (Saanen):\n• ME: 11–13 MJ/kg DM  CP: 16–20% DM\n• Ca: 0.8–1.0%  P: 0.4–0.5%\n\nKey references: NRC Small Ruminants (2007), AFRC.`,

  donkey: `**Donkey Nutrient Requirements**\n\nNutrix has a donkey performance library covering breeds: Dezhou Wutou, Dezhou Sanfen, Guanzhong, Jinnan, Poitou, Mammoth Jackstock, Standard Donkey. The library contains growth curves and reproductive standards but not formulated feed nutrient targets.\n\nGeneral guidelines for adult working donkey (150–200 kg):\n• DE: 1.8–2.2 Mcal/100 kg BW/day  CP: 8–10% DM\n• Ca: 0.35–0.4%  P: 0.25–0.3%\n• Donkeys are efficient foragers — avoid overfeeding energy-dense feeds (laminitis risk).\n\nKey references: ACVA/BEVA guidelines, INRAE Donkey Nutrition 2018.`,

  mule: `**Mule Nutrient Requirements**\n\nNutrix has a mule performance library (Draft Mule, Pack Mule, Farm Mule, Saddle Mule, Miniature Mule, Hinny) with workload standards. Feed formulation nutrient targets are not yet queryable.\n\nGeneral guidelines (400–500 kg working mule):\n• DE: 2.2–3.0 Mcal/100 kg BW/day (depending on work intensity)\n• CP: 8–12% DM  Ca: 0.35–0.45%  P: 0.25–0.35%\n• Mules have hybrid vigor — more efficient than horses; diet similar to horse but lower energy density.\n\nKey reference: NRC Nutrient Requirements of Horses (2007).`,

  shrimp: `**Shrimp Nutrient Requirements (Litopenaeus vannamei)**\n\nNutrix does not yet have a built-in shrimp library. General guidelines (NRC Fish & Shrimp 2011, industry data):\n\n• Crude Protein: 32–38%\n• Lipid: 6–8%\n• ME: 3,300–3,500 kcal/kg\n• Ca: 0.8–1.2%  P: 0.9–1.2%\n• Lys: 2.1–2.5% of diet (SID basis)\n• Met+Cys: 1.3–1.6% of diet\n• Ash: ≤14%\n\nValues vary by life stage (pre-larval, post-larval, juvenile, sub-adult, broodstock). Cholesterol (0.3–0.5%) and phospholipids (1–3%) are essential. Consult your specific breed supplier for exact dietary specs.`,

  salmon: `**Salmon/Trout Nutrient Requirements**\n\nKey reference: NRC Nutrient Requirements of Fish and Shrimp (2011), Salmonid field data.\n\n• Crude Protein: 38–45%  Lipid: 22–30%  ME: 22–25 MJ/kg\n• Lys: 2.0–2.4%  Met: 0.8–1.0%  Thr: 1.2–1.6%\n• Ca: 0.5–0.7%  P: 0.8–1.0%  (avail P preferred)\n• Essential fatty acids: EPA+DHA ≥1.5%`,

  tilapia: `**Tilapia Nutrient Requirements (Oreochromis niloticus)**\n\nKey reference: NRC (2011), El-Sayed 2006.\n\n• Crude Protein: 28–35% (juveniles), 25–30% (adults)\n• Lipid: 5–8%  ME: 14–16 MJ/kg\n• Lys: 1.6–2.2%  Met+Cys: 0.9–1.2%\n• P: 0.5–0.8%  Ca: 0.4–0.6%`,

  catfish: `**Catfish Nutrient Requirements**\n\nKey reference: NRC (2011), USDA channel catfish data.\n\n• Crude Protein: 28–36%  Lipid: 5–8%\n• ME: 13–15 MJ/kg  Lys: 1.4–1.8%  Met+Cys: 0.7–1.0%\n• P: 0.5–0.7%  Ca: 0.35–0.5%`,

  fish: `**Fish/Aquaculture Nutrient Requirements**\n\nNutrix does not currently have a built-in aquaculture library. The key reference is NRC Nutrient Requirements of Fish and Shrimp (2011). Requirements vary greatly by species, life stage, and water temperature. Ask a more specific question — for example: "salmon requirements", "tilapia grower nutrients", or "shrimp broodstock diet".`,

  dog: `**Dog (Canine) Nutrient Requirements**\n\nKey references: AAFCO 2023 Nutrient Profiles, NRC Nutrient Requirements of Dogs and Cats (2006).\n\nAFFCO Adult Maintenance minimums:\n• Crude Protein: ≥18% DM  Crude Fat: ≥5.5% DM\n• Ca: 0.5–2.5%  P: 0.4–2.0%  Ca:P ratio 1:1–2:1\n• Lys: 0.63%  Met+Cys: 0.65%  Thr: 0.53%\n• Taurine: Not listed in AAFCO (but important, especially in grain-free diets)\n\nGrowth/Reproduction profiles have higher requirements (protein ≥22%, Ca 1.2–1.8%).`,

  cat: `**Cat (Feline) Nutrient Requirements**\n\nKey references: AAFCO 2023 Nutrient Profiles, NRC Nutrient Requirements of Dogs and Cats (2006).\n\nAFFCO Adult Maintenance minimums:\n• Crude Protein: ≥26% DM  Crude Fat: ≥9% DM\n• Taurine: ≥0.1% DM  Arginine: ≥1.04% DM\n• Ca: 0.6–1.5%  P: 0.5–1.6%\n• Arachidonic acid (AA): ≥0.02%\n• Cats are obligate carnivores — they require preformed vitamin A, taurine, and arachidonic acid from animal sources.`,

  camel: `**Camel Nutrient Requirements**\n\nNutrix has a camel performance library (Dromedary, Bactrian, Kharai) tracking growth curves, milk yield, and draft performance targets. Formulation-ready nutrient requirement tables specific to camels are not yet in the Nutrix engine.\n\nDromedary camel (Camelus dromedarius) estimated requirements — Faye & Bengoumi 2018 / FAO:\n\n**Adult Maintenance (400–500 kg BW):**\n• ME: 50–65 MJ/day  DE: 55–70 MJ/day\n• CP: 1,200–1,500 g/day (10–12% DM)\n• NDF: ≥35% DM (highly adapted to fibrous browse and hay)\n• Ca: 8–12 g/day  P: 6–10 g/day  Na: 3–8 g/day  Mg: 4–8 g/day\n\n**Lactating camel (8–12 L/day peak):**\n• ME: 80–100 MJ/day  CP: 2,000–2,500 g/day (14–16% DM)\n• Ca: 15–25 g/day  P: 12–18 g/day  Na: 5–10 g/day\n\n**Growing camel (yearling–sub-adult, ADG 300–500 g/day):**\n• ME: 40–55 MJ/day  CP: 1,000–1,400 g/day (12–14% DM)\n• Ca: 10–15 g/day  P: 8–12 g/day\n\n**Key references:** Faye & Bengoumi 2018 (Camel Medicine & Management), FAO Wardeh 1989, Kaufmann 1998.\n\n> ⚠️ Camel-specific nutrient tables are far less standardized than bovine/ovine species. Use these as starting estimates only; camel feeding is predominantly managed by quality of browse and range assessment rather than precision formulation.`,

  south_american_camelid: `**South American Camelid Nutrient Requirements**\n\nNutrix has a performance library for llamas and alpacas. Formulation-ready nutrient requirement tables are not yet in the Nutrix engine.\n\nLlama/Alpaca adult maintenance (60–120 kg BW) — NRC Small Ruminants 2007 (partial) + field data:\n• ME: 10–16 MJ/day  CP: 8–12% DM (600–900 g/day for adult llama)\n• NDF: ≥35% DM (highly adapted to poor-quality forages)\n• Ca: 0.4–0.6% DM  P: 0.3–0.5% DM  Cu: 8–12 ppm DM (sensitive to Cu toxicity — cap ≤15 ppm)\n• Vitamin D: Important; pasture exposure typically adequate\n\nPregnancy/Lactation: increase ME by 20–30%, CP by 25–35%.\n\n> ⚠️ SAC nutrient tables have limited research base. Consult a camelid specialist for precision formulation.`,
};

// ─── OpenAI / Groq client factory ─────────────────────────────────────────────

function makeClient() {
  const opts = { apiKey: process.env.OPENAI_API_KEY };
  if (process.env.OPENAI_BASE_URL) opts.baseURL = process.env.OPENAI_BASE_URL;
  return new OpenAI(opts);
}

// ─── Recommendations (rule-based, unchanged) ──────────────────────────────────

function buildRuleBasedRecommendations({ formulaRows, bindingConstraints, ingredientBoundStatus, sensitivityRows }) {
  const recommendations = [];
  const shadowPriceByNutrient = {};
  sensitivityRows.forEach(row => {
    if (row?.nutrient && row.marginal_cost_estimate != null) {
      const key = row.nutrient;
      if (!(key in shadowPriceByNutrient) || Math.abs(row.marginal_cost_estimate) > Math.abs(shadowPriceByNutrient[key]))
        shadowPriceByNutrient[key] = row.marginal_cost_estimate;
    }
  });
  bindingConstraints.forEach(bc => {
    const shadow = shadowPriceByNutrient[bc.nutrient];
    recommendations.push({
      type:"binding_constraint", nutrient:bc.nutrient,
      message: shadow != null
        ? `${nutrientLabel(bc.nutrient)} is a binding constraint. Easing it by one unit is estimated to change cost by $${shadow.toFixed(2)}/ton — sourcing a cheaper ingredient richer in ${nutrientLabel(bc.nutrient)} could reduce overall feed cost.`
        : `${nutrientLabel(bc.nutrient)} is currently a binding constraint, limiting further cost reduction.`
    });
  });
  const costs = formulaRows.map(r => Number(r.cost)||0).filter(c=>c>0);
  const avgCost = costs.length ? costs.reduce((s,c)=>s+c,0)/costs.length : 0;
  ingredientBoundStatus.forEach(ing => {
    const cost = Number(ing.cost)||0;
    if (ing.at_max && ing.inclusion>0 && cost>avgCost)
      recommendations.push({ type:"ingredient_at_max", ingredient_id:ing.id, ingredient_name:ing.display_name,
        message:`${ing.display_name} is at its maximum inclusion (${ing.inclusion}%) and costs more than the formula average — consider sourcing a cheaper alternative.` });
    if (ing.at_min && ing.slack_to_max>0 && cost>0 && cost<avgCost)
      recommendations.push({ type:"ingredient_at_min", ingredient_id:ing.id, ingredient_name:ing.display_name,
        message:`${ing.display_name} is below-average cost but capped at its minimum inclusion — raising its allowed maximum could let the optimizer use more of it and reduce cost.` });
  });
  return recommendations;
}

// ─── Formula Generation ───────────────────────────────────────────────────────

const Database = (() => { try { return require('better-sqlite3'); } catch { return null; } })();
const { randomUUID } = require('crypto');
const http = require('http');

// ─── AgroCore MLA: log every Nutrix AI interaction to the learning corpus ─────
// Same table that multimix copilot uses — grows a unified cross-module Q&A corpus
// for future RAG retrieval and model fine-tuning. Fire-and-forget: never blocks response.
function logToMLA({ usr, question, answer, source, grounding = {} }) {
  if (!Database) return;
  try {
    const dbPath = path.join(process.cwd(), 'data', 'mill.db');
    const db = new Database(dbPath);
    db.prepare(`CREATE TABLE IF NOT EXISTS copilot_interactions (
      id TEXT PRIMARY KEY, mill_id TEXT, usr TEXT, question TEXT, answer TEXT,
      grounding TEXT, feedback INTEGER, created_at TEXT
    )`).run();
    db.prepare(`INSERT INTO copilot_interactions
      (id, mill_id, usr, question, answer, grounding, feedback, created_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(
        randomUUID(), null,
        usr || 'nutrix',
        String(question || '').slice(0, 2000),
        String(answer || '').slice(0, 8000),
        JSON.stringify({ source, ...grounding }),
        null,
        new Date().toISOString()
      );
    db.close();
    try {
      const { logActivity } = require("../../../core/intelligence/collectors/activity.collector.cjs");
      logActivity({
        source: "nutrix", kind: "ai", user_id: usr || "nutrix",
        title: question, text: answer, metadata: { source, ...grounding }, skipMill: true
      });
    } catch { /* ignore */ }
  } catch { /* never interrupt the response */ }
}

function isFormulationRequest(question) {
  const q = question.toLowerCase();
  const action = /\b(formulate|create|generate|design|make|build|prepare|develop|suggest|recommend)\b/;
  const diet = /\b(complete\s+)?(diet|formula|ration|feed(?:\s+formula)?|mix|blend|recipe)\b/;
  const explicit = /\b(feed\s+formulation|diet\s+formulation|formulate\s+a|create\s+a\s+formula|design\s+a\s+ration|generate\s+a\s+diet|formula\s+for|ration\s+for|diet\s+for\s+(?:a\s+)?(?:starter|grower|finisher|layer|broiler|chick|piglet|nursery|lamb|calf)|formulate.*(?:starter|grower|finisher|diet|ration|formula))\b/;
  return explicit.test(q) || (action.test(q) && diet.test(q));
}

function fetchUserIngredients(username, millId, species) {
  if (!Database) return [];
  try {
    const dbPath = path.join(process.cwd(), 'data', 'mill.db');
    const db = new Database(dbPath, { readonly: true });
    let row = null;
    if (millId && millId !== 'default') {
      row = db.prepare(
        'SELECT rows_json FROM ingredient_intelligence_library WHERE mill_id=? AND species=? AND username=? AND db_id=? ORDER BY updated_at DESC LIMIT 1'
      ).get(millId, species || 'poultry', username, 'base');
    }
    if (!row) {
      row = db.prepare(
        'SELECT rows_json FROM ingredient_intelligence_library WHERE species=? AND username=? AND db_id=? ORDER BY json_array_length(rows_json) DESC, updated_at DESC LIMIT 1'
      ).get(species || 'poultry', username, 'base');
    }
    // Species-agnostic fallback: use the largest available II for this user regardless of species
    if (!row) {
      row = db.prepare(
        'SELECT rows_json FROM ingredient_intelligence_library WHERE username=? AND db_id=? ORDER BY json_array_length(rows_json) DESC, updated_at DESC LIMIT 1'
      ).get(username, 'base');
    }
    db.close();
    if (!row) return [];
    const rows = JSON.parse(row.rows_json);
    return rows.filter(r => r.active !== false && r.status !== 'inactive');
  } catch(e) {
    console.error('[AI formula] fetchUserIngredients error:', e.message);
    return [];
  }
}

function libKeyToOptKey(key) {
  return key
    .replace(/_pct$/, '')
    .replace(/_kcal(?:_per)?_kg$/, '')
    .replace(/_mj(?:_per)?_kg$/, '')
    .replace(/_mcal(?:_per)?_kg$/, '')
    .replace(/_iu(?:_per)?_kg$/, '')
    .replace(/_ppm$/, '');
}

function targetsToConstraints(targets) {
  if (!targets || typeof targets !== 'object') return [];
  const out = [];
  // Keys where only a minimum applies (energy — can always be higher)
  const minOnlyKeys = new Set(['me','me_kcal_per_kg','me_kcal_kg','ne','de','linoleic_acid','linoleic_acid_pct']);
  // Mineral keys — looser cap (×2) since small absolute values tolerate wider range
  const mineralKeys  = new Set(['ca','total_p','avp','sttd_p','na','cl','k','mg','s','fe','zn','mn','cu','i','co','se']);
  // Everything else (CP, amino acids): tight cap — target × 1.1 to stay close to requirements

  for (const [key, val] of Object.entries(targets)) {
    const optKey = libKeyToOptKey(key);
    if (!optKey) continue;

    // Val is a plain number (most common case in the CDB library)
    if (typeof val === 'number' && isFinite(val)) {
      if (minOnlyKeys.has(optKey) || minOnlyKeys.has(key)) {
        out.push({ key: optKey, min: val });
      } else if (mineralKeys.has(optKey)) {
        out.push({ key: optKey, min: val, max: +(val * 1.4).toFixed(4) });
      } else {
        // Tight cap: keep nutrients close to target (10% headroom)
        out.push({ key: optKey, min: val, max: +(val * 1.1).toFixed(4) });
      }
    // Val is an object with min/max/target sub-keys (structured format)
    } else if (val && typeof val === 'object') {
      const c = { key: optKey };
      let has = false;
      if (val.min != null && isFinite(+val.min)) { c.min = +val.min; has = true; }
      if (val.max != null && isFinite(+val.max)) { c.max = +val.max; has = true; }
      if (val.target != null && isFinite(+val.target)) { c.target = +val.target; has = true; }
      if (has) out.push(c);
    }
  }
  return out;
}

function ingredientMaxByCategory(row) {
  const name = (row.ingredient_name || '').toLowerCase();
  const cat  = (row.category || '').toLowerCase();
  // Energy
  if (/\b(corn|maize)\b/.test(name)) return 70;
  if (/\b(wheat|barley|sorghum|milo)\b/.test(name)) return 50;
  if (/\b(rice bran|ddgs)\b/.test(name)) return 10;
  // Fats / oils
  if (/\b(oil|fat|tallow|lard)\b/.test(name) || cat.includes('fat')) return 5;
  // Animal proteins — tightly capped
  if (/\b(fish.*meal)\b/.test(name)) return 8;
  if (/\b(blood.*meal)\b/.test(name)) return 3;
  if (/\b(meat.*meal|poultry.*by.?prod|feather)\b/.test(name)) return 5;
  if (/\b(animal.*protein.*conc|albumin|spirulina|algae|single.cell)\b/.test(name) || cat.includes('animal_protein') || cat.includes('single_cell')) return 4;
  // Plant proteins
  if (/\b(soybean|soy.*meal)\b/.test(name)) return 35;
  if (/\b(canola|rapeseed)\b/.test(name)) return 8;
  if (/\b(sunflower|cottonseed)\b/.test(name)) return 6;
  if (/\b(peanut|sesame|lupin|field.*pea|faba|vetch)\b/.test(name)) return 8;
  if (cat.includes('oilseed_meal') || cat.includes('protein')) return 10;
  // Minerals
  if (/\b(limestone|calcium.*carb|oyster)\b/.test(name)) return 12;
  if (/\b(dicalcium|di-calcium|monocalcium|mono-calcium|\bdcp\b|\bmcp\b)\b/.test(name)) return 3;
  if (/\b(salt\b|sodium.*chloride)\b/.test(name)) return 0.5;
  // Amino acids / additives
  if (cat.includes('synthetic_aa') || /\b(dl-methionine|l-lysine|l-threonine|l-tryptophan|l-valine|l-isoleucine|l-leucine|l-arginine|l-his|l-phe)\b/.test(name)) return 0.6;
  if (/\b(choline|betaine)\b/.test(name)) return 0.3;
  if (/\b(premix|vitamin|mineral.*mix|enzyme|phytase|amylase|acidifier|agp|anti-cocc)\b/.test(name) || cat.includes('premix') || cat.includes('feed_additive')) return 1;
  return 15;
}

function buildIngredientPool(iiRows) {
  return iiRows.map(row => {
    const id = row.profile_id || row.base_ingredient_id || row.ingredient_code || `ing_${row.ingredient_name}`;
    const pricePerTon = typeof row.price === 'number' ? row.price : null;
    const costPer100kg = pricePerTon != null ? +(pricePerTon / 10).toFixed(4) : 1;
    return {
      ...row,
      id,
      display_name: row.ingredient_name || id,
      min: 0,
      max: ingredientMaxByCategory(row),
      cost: costPer100kg,
      enabled: true
    };
  });
}

// Standard commodity ingredients added when the user's pool can't meet key nutrient targets.
// Values are typical feed-grade assay values.
const COMMODITY_SUPPLEMENTS = [
  { id:'_ai_limestone', ingredient_name:'Limestone (Feed Grade)', category:'mineral',
    ca:38.0, total_p:0.02, avp:0.01, na:0.01, cl:0.01, me:0, cp:0, ee:0, cf:0, ash:96, dm:99,
    min:0, max:12, cost:0.8, enabled:true },   // max 12% — typical broiler ceiling
  { id:'_ai_dcp', ingredient_name:'Dicalcium Phosphate', category:'mineral',
    ca:22.0, total_p:18.5, avp:18.0, sttd_p:17.5, na:0.02, cl:0.01, me:0, cp:0, ee:0, cf:0, ash:95, dm:98,
    min:0, max:3, cost:5.0, enabled:true },
  { id:'_ai_mcp', ingredient_name:'Monocalcium Phosphate', category:'mineral',
    ca:16.0, total_p:21.0, avp:21.0, sttd_p:20.5, na:0.02, me:0, cp:0, ee:0, cf:0, ash:92, dm:97,
    min:0, max:2, cost:5.5, enabled:true },
  { id:'_ai_salt', ingredient_name:'Salt (NaCl)', category:'mineral',
    na:39.3, cl:60.6, me:0, cp:0, ee:0, cf:0, ash:99, dm:99,
    min:0, max:0.5, cost:1.0, enabled:true },
  { id:'_ai_lysine', ingredient_name:'L-Lysine HCl (78.8%)', category:'synthetic_aa',
    total_lys:78.8, sid_lys:74.6, total_lys_pct:78.8, sid_lys_pct:74.6,
    cp:94.4, me:3800, ee:0, cf:0, ash:4, dm:99,
    min:0, max:0.6, cost:15.0, enabled:true },
  { id:'_ai_methionine', ingredient_name:'DL-Methionine (99%)', category:'synthetic_aa',
    total_met:99.0, sid_met:99.0, total_metcys:99.0, sid_metcys:99.0,
    total_met_pct:99.0, sid_met_pct:99.0, sid_metcys_pct:99.0,
    cp:58.8, me:5400, ee:0, cf:0, ash:1, dm:99,
    min:0, max:0.5, cost:30.0, enabled:true },
  { id:'_ai_threonine', ingredient_name:'L-Threonine (98.5%)', category:'synthetic_aa',
    total_thr:98.5, sid_thr:98.5, total_thr_pct:98.5, sid_thr_pct:98.5,
    cp:46.0, me:3500, ee:0, cf:0, ash:1, dm:99,
    min:0, max:0.4, cost:18.0, enabled:true },
  { id:'_ai_tryptophan', ingredient_name:'L-Tryptophan (98%)', category:'synthetic_aa',
    total_trp:98.0, sid_trp:98.0, total_trp_pct:98.0, sid_trp_pct:98.0,
    cp:70.0, me:3500, ee:0, cf:0, ash:1, dm:99,
    min:0, max:0.15, cost:55.0, enabled:true },
  { id:'_ai_valine', ingredient_name:'L-Valine (98.5%)', category:'synthetic_aa',
    total_val:98.5, sid_val:98.5, total_val_pct:98.5, sid_val_pct:98.5,
    cp:68.0, me:3500, ee:0, cf:0, ash:1, dm:99,
    min:0, max:0.3, cost:25.0, enabled:true },
  { id:'_ai_soyoil', ingredient_name:'Soybean Oil', category:'fat',
    ee:99.5, me:8800, ne:6500, cp:0, cf:0, ca:0, total_p:0, na:0, dm:99,
    linoleic_acid:51.0,
    min:0, max:6, cost:10.0, enabled:true },
];

// Returns the maximum a nutrient key can reach given the pool (sum of max*value for that key)
function maxAchievable(pool, nutrientKey) {
  return pool.reduce((acc, ing) => {
    const v = ing[nutrientKey] ?? 0;
    const m = ing.max ?? 100;
    return acc + (v * m / 100);
  }, 0);
}

// Auto-supplement the pool with essential commodity ingredients when the pool can't meet key targets
function supplementPoolForTargets(pool, constraints) {
  const supplemented = [...pool];
  const existingIds = new Set(pool.map(i => i.id));

  const constMap = {};
  for (const c of constraints) constMap[c.key] = c;

  const addIfNeeded = (nutrientKey, targetFraction, supplementId) => {
    const c = constMap[nutrientKey];
    if (!c) return;
    const target = c.min ?? 0;
    if (!target) return;
    const achievable = maxAchievable(supplemented, nutrientKey);
    if (achievable < target * targetFraction) {
      const supp = COMMODITY_SUPPLEMENTS.find(s => s.id === supplementId);
      if (supp && !existingIds.has(supplementId)) {
        supplemented.push({ ...supp });
        existingIds.add(supplementId);
      }
    }
  };

  // Ca — add limestone if pool max Ca < 50% of target
  addIfNeeded('ca', 0.5, '_ai_limestone');
  // avP / total_p — add DCP if pool max avP < 50% of target
  addIfNeeded('avp', 0.5, '_ai_dcp');
  if (!constMap['avp'] && constMap['total_p']) addIfNeeded('total_p', 0.5, '_ai_dcp');
  // Na — add salt if pool max Na < 40% of target
  addIfNeeded('na', 0.4, '_ai_salt');
  // SID Lys — add L-Lysine if pool max sid_lys < 90% of target
  addIfNeeded('sid_lys', 0.9, '_ai_lysine');
  // SID Met or SID Met+Cys — add DL-Met if needed
  addIfNeeded('sid_met', 0.9, '_ai_methionine');
  if (!constMap['sid_met']) addIfNeeded('sid_metcys', 0.9, '_ai_methionine');
  // SID Thr
  addIfNeeded('sid_thr', 0.9, '_ai_threonine');
  // SID Trp
  addIfNeeded('sid_trp', 0.9, '_ai_tryptophan');
  // SID Val
  addIfNeeded('sid_val', 0.9, '_ai_valine');
  // Linoleic acid — add soy oil if needed
  addIfNeeded('linoleic_acid', 0.7, '_ai_soyoil');

  return supplemented;
}

function runInternalOptimize(payload, port) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1', port: port || 3001, path: '/v1/optimize', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('optimize timeout')); });
    req.write(body); req.end();
  });
}

function runInternalAnalyze(payload, port) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1', port: port || 3001, path: '/v1/analyze', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('analyze timeout')); });
    req.write(body); req.end();
  });
}

function formatAiFormulaAnswer(formulaData, breedLabel, phaseLabel, nutrientResults) {
  const usedRows = (formulaData.formula_rows || [])
    .filter(r => (r.optimized_inclusion ?? r.inclusion ?? 0) > 0.01)
    .sort((a, b) => (b.optimized_inclusion ?? b.inclusion ?? 0) - (a.optimized_inclusion ?? a.inclusion ?? 0));

  let md = `## AI-Formulated Diet: ${breedLabel}${phaseLabel ? ' – ' + phaseLabel.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()) : ''}\n\n`;
  md += `*Generated using your active Ingredient Intelligence database · LP least-cost optimization*\n\n`;

  if (usedRows.length) {
    md += `### Formula Composition\n\n| Ingredient | Inclusion (%) |\n|---|---|\n`;
    for (const r of usedRows) {
      const pct = +(r.optimized_inclusion ?? r.inclusion ?? 0).toFixed(2);
      md += `| ${r.ingredient_name} | ${pct} |\n`;
    }
    md += '\n';
  }

  if (nutrientResults && typeof nutrientResults === 'object' && !Array.isArray(nutrientResults)) {
    const LABEL_MAP = {
      me:'ME (kcal/kg)', me_mj:'ME (MJ/kg)', amen:'AMEn (kcal/kg)', de:'DE (Mcal/kg)', de_mcal_kg:'DE (Mcal/kg)',
      ne:'NE (kcal/kg)', ne_mj:'NE (MJ/kg)',
      dm:'DM (%)', moisture:'Moisture (%)',
      cp:'CP (%)', ee:'Ether Extract (%)', cf:'Crude Fibre (%)', ash:'Ash (%)',
      starch:'Starch (%)', sugars:'Sugars (%)', ndf:'NDF (%)', adf:'ADF (%)', lignin:'Lignin (%)',
      ca:'Ca (%)', total_p:'Total P (%)', avp:'avP (%)', sttd_p:'STTD P (%)',
      na:'Na (%)', cl:'Cl (%)', k:'K (%)', mg:'Mg (%)', s:'S (%)',
      total_lys:'Total Lys (%)', total_met:'Total Met (%)', total_cys:'Total Cys (%)',
      total_metcys:'Total Met+Cys (%)', total_thr:'Total Thr (%)', total_trp:'Total Trp (%)',
      total_arg:'Total Arg (%)', total_val:'Total Val (%)', total_ile:'Total Ile (%)', total_leu:'Total Leu (%)',
      sid_lys:'SID Lys (%)', sid_met:'SID Met (%)', sid_cys:'SID Cys (%)', sid_metcys:'SID Met+Cys (%)',
      sid_thr:'SID Thr (%)', sid_trp:'SID Trp (%)', sid_arg:'SID Arg (%)',
      sid_val:'SID Val (%)', sid_ile:'SID Ile (%)', sid_leu:'SID Leu (%)', sid_phe:'SID Phe (%)',
      fe:'Fe (mg/kg)', zn:'Zn (mg/kg)', mn:'Mn (mg/kg)', cu:'Cu (mg/kg)',
      se:'Se (mg/kg)', i:'I (mg/kg)', co:'Co (mg/kg)',
      vit_a:'Vitamin A (IU/kg)', vit_d3:'Vitamin D3 (IU/kg)', vit_e:'Vitamin E (IU/kg)',
      vit_k:'Vitamin K (mg/kg)', vit_b2:'Vit B2 (mg/kg)', vit_b12:'Vit B12 (µg/kg)',
      linoleic_acid:'Linoleic Acid (%)', omega3:'Omega-3 (%)'
    };
    const DISPLAY_ORDER = [
      'me','me_mj','de','de_mcal_kg','ne','ne_mj','amen',
      'dm','moisture','cp','ee','cf','ash','starch','sugars','ndf','adf','lignin',
      'ca','total_p','avp','sttd_p','na','cl','k','mg','s',
      'total_lys','total_met','total_cys','total_metcys','total_thr','total_trp','total_arg','total_val','total_ile','total_leu',
      'sid_lys','sid_met','sid_cys','sid_metcys','sid_thr','sid_trp','sid_arg','sid_val','sid_ile','sid_leu','sid_phe',
      'fe','zn','mn','cu','se','i','co',
      'vit_a','vit_d3','vit_e','vit_k','vit_b2','vit_b12',
      'linoleic_acid','omega3'
    ];
    const seen = new Set();
    const orderedKeys = [...DISPLAY_ORDER, ...Object.keys(nutrientResults)];
    const rows = [];
    for (const k of orderedKeys) {
      if (seen.has(k)) continue;
      seen.add(k);
      const v = nutrientResults[k];
      if (v == null || !Number.isFinite(+v) || +v === 0) continue;
      rows.push({ label: LABEL_MAP[k] || k, val: +Number(v).toFixed(4) });
    }
    if (rows.length) {
      md += `### Achieved Nutrient Profile\n\n| Nutrient | Value |\n|---|---|\n`;
      for (const r of rows) md += `| ${r.label} | ${r.val} |\n`;
      md += '\n';
    }
  }

  md += `> Click **📥 Load into Workspace** below to fine-tune this formula.`;
  return md;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/health", (_req, res) => {
  res.json({
    ok:true, service:"nutrix-ai", model:DEFAULT_MODEL,
    openai_key_loaded: Boolean(process.env.OPENAI_API_KEY),
    base_url: process.env.OPENAI_BASE_URL || "openai default",
    library_entries: LIBRARY_CATALOG.length
  });
});

router.get("/manual", (_req, res) => {
  const guide = loadFeatureGuide();
  return res.json({
    ok: true,
    product: guide.product || "Nutrix",
    intro: guide.intro || "",
    features: guide.features || []
  });
});

router.post("/ask", async (req, res) => {
  try {
    const question = safeText(req.body?.question);
    if (!question) return res.status(400).json({ ok:false, error:"question is required" });

    const requestedTopicId = safeText(req.body?.context?.manual_topic_id);
    const pinned = lookupFeatureById(requestedTopicId);
    if (pinned) {
      const answer = formatFeatureAnswer(pinned);
      setImmediate(() => logToMLA({
        usr: safeText(req.nutrixUser || "default"),
        question,
        answer,
        source: "manual"
      }));
      return res.json({ ok: true, answer, model: "nutrix-manual", source: "manual", topic_id: pinned.id });
    }

    const guideHit = matchFeatureGuide(question);
    const nutrientQ = isNutrientRequirementQuery(question);
    const softwareHelp = isSoftwareHelpQuestion(question);
    if (guideHit && !isFormulationRequest(question) && (softwareHelp || guideHit.score >= 8) && !(nutrientQ && guideHit.score < 10)) {
      const answer = formatFeatureAnswer(guideHit.feature);
      setImmediate(() => logToMLA({
        usr: safeText(req.nutrixUser || "default"),
        question,
        answer,
        source: "manual"
      }));
      return res.json({ ok: true, answer, model: "nutrix-manual", source: "manual", topic_id: guideHit.feature.id });
    }

    const context = compactContext(req.body?.context || {});
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    // ── Step 0: AI formula generation ────────────────────────────────────
    const reqUser  = safeText(req.nutrixUser || 'default');
    const reqMillId = safeText(req.body?.context?.mill_id || '');

    if (isFormulationRequest(question)) {
      try {
        const speciesCtx    = context.species  || 'poultry';
        const typeCtx       = context.type     || 'broiler';
        const productionCtx = context.production || 'meat';
        const breedCtx      = context.breed    || '';
        const phaseCtx      = context.phase    || (req.body?.context?.stage) || '';

        // Resolve entry/phase from question, then fall back to workspace context
        const parsedFml = parseLibraryQuery(question)
          || (breedCtx ? parseLibraryQuery(`${breedCtx} ${phaseCtx} requirements`) : null);
        const fmlEntry = parsedFml?.entry || null;
        const fmlPhase = parsedFml?.phase || phaseCtx || null;

        let targets   = null;
        let breedLabel = fmlEntry?.label || breedCtx || speciesCtx;
        let phaseLabel = fmlPhase;

        if (fmlEntry) {
          const data = readJson(fmlEntry.file);
          const profiles = selectProfiles(data, fmlEntry, fmlPhase);
          if (profiles.length) {
            targets    = profiles[0].targets;
            breedLabel = fmlEntry.label || breedLabel;
            phaseLabel = profiles[0].phase || fmlPhase;
          }
        }

        const iiRows = fetchUserIngredients(reqUser, reqMillId, speciesCtx);
        if (iiRows.length < 3) {
          return res.json({
            ok: true,
            answer: `I can formulate a diet for you, but your **Ingredient Intelligence** database for ${speciesCtx} appears to be empty or has too few entries (found ${iiRows.length}). Please add at least 3–5 core ingredients (energy source, protein meal, mineral/Ca+P sources) to your Ingredient Intelligence first, then ask again.`,
            model: 'nutrix-formula-guard', source: 'guard'
          });
        }

        const ingredientPool        = buildIngredientPool(iiRows);
        const nutrientConstraints   = targets ? targetsToConstraints(targets) : [
          { key: 'me', min: 2800, max: 3200 },
          { key: 'cp', min: 18,   max: 24 }
        ];
        if (!nutrientConstraints.length) nutrientConstraints.push({ key: 'cp', min: 18, max: 24 });

        // Auto-supplement pool with standard commodities the user may not have in their II
        // (limestone, DCP, salt, L-Lys, DL-Met, etc.) so the LP can meet Ca/P/Na/AA targets
        const fullPool = supplementPoolForTargets(ingredientPool, nutrientConstraints);
        const poolSupplementIds = new Set(
          fullPool.filter(i => i.id && i.id.startsWith('_ai_')).map(i => i.id)
        );

        const optResult = await runInternalOptimize({
          species: speciesCtx, type: typeCtx, production: productionCtx,
          breed: fmlEntry?.breedFilter || breedCtx || 'generic',
          phase: fmlPhase, formula_basis: 100, objective: 'least_cost',
          ingredient_pool: fullPool,
          nutrient_constraints: nutrientConstraints
        }, process.env.PORT || 3001);

        if (!optResult || optResult.status !== 'optimal') {
          return res.json({
            ok: true,
            answer: `I tried to formulate a ${breedLabel}${phaseLabel ? ' ' + phaseLabel : ''} diet using your ${iiRows.length} ingredients, but the optimizer could not find a feasible solution. This usually happens when nutrient requirements cannot be met with the available ingredients. Try adding more ingredient types (energy grain, protein meal, Ca/P sources, amino acids) to your Ingredient Intelligence.\n\n*Optimizer: ${optResult?.message || 'infeasible'}*`,
            model: 'nutrix-formula', source: 'formula'
          });
        }

        const optimizedFormula = optResult.optimized_formula || [];

        // Build formula rows from user's II ingredients
        const formulaRows = iiRows.map(row => {
          const id  = row.profile_id || row.base_ingredient_id || row.ingredient_code || `ing_${row.ingredient_name}`;
          const used = optimizedFormula.find(r => r.id === id);
          const inclusion = used ? +(used.inclusion || 0).toFixed(4) : 0;
          return {
            ingredient_code: row.ingredient_code || '',
            ingredient_id:   row.base_ingredient_id || id,
            ingredient_name: row.ingredient_name,
            inclusion,
            optimized_inclusion: inclusion,
            min: null, max: null,
            included: inclusion > 0,
            cost: row.price || null,
            qc_status: 'normal',
            _source: 'user_ii'
          };
        });

        // Append auto-supplemented commodity rows that were actually used (inclusion > 0)
        for (const suppIng of fullPool) {
          if (!poolSupplementIds.has(suppIng.id)) continue;
          const used = optimizedFormula.find(r => r.id === suppIng.id);
          const inclusion = used ? +(used.inclusion || 0).toFixed(4) : 0;
          if (inclusion > 0.001) {
            formulaRows.push({
              ingredient_code: suppIng.id,
              ingredient_id: suppIng.id,
              ingredient_name: suppIng.ingredient_name,
              inclusion,
              optimized_inclusion: inclusion,
              min: null, max: null,
              included: true,
              cost: null,
              qc_status: 'normal',
              _source: 'ai_standard'
            });
          }
        }

        const formulaName = `AI: ${breedLabel}${phaseLabel ? ' – ' + phaseLabel.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()) : ''}`;
        const formulaData = {
          formula_id: null, formula_name: formulaName,
          species: speciesCtx, type: typeCtx, production: productionCtx,
          breed: fmlEntry?.breedFilter || breedCtx || '', phase: fmlPhase || '',
          formula_rows: formulaRows, batch_size: 1000, batch_unit: 'kg', ratio_rows: []
        };

        // Get full nutrient profile via analyze (optimizer only returns constrained nutrients)
        let fullNutrients = optResult.nutrient_results || {};
        try {
          const fmlText = formulaRows
            .filter(r => (r.inclusion || 0) > 0.01)
            .map(r => `${r.ingredient_name} ${+(r.inclusion || 0).toFixed(4)}`)
            .join('\n');
          // Combine user's II rows with commodity supplement rows for the analyze call,
          // so the engine has nutrient values for limestone, DCP, salt, amino acids, etc.
          const allIngRows = [...iiRows];
          for (const suppIng of fullPool) {
            if (poolSupplementIds.has(suppIng.id)) {
              allIngRows.push({ ...suppIng, ingredient_name: suppIng.ingredient_name });
            }
          }
          const analyzeRes = await runInternalAnalyze({
            species: speciesCtx, type: typeCtx, production: productionCtx,
            breed: fmlEntry?.breedFilter || breedCtx || '',
            phase: fmlPhase || '',
            formula_text: fmlText,
            ingredient_intelligence: allIngRows
          }, process.env.PORT || 3001);
          const nc = analyzeRes?.nutrient_profile_full || analyzeRes?.nutrient_profile
                   || analyzeRes?.calculated_nutrients || analyzeRes?.nutrients || {};
          if (Object.keys(nc).length > 0) fullNutrients = nc;
        } catch(analyzeErr) {
          console.warn('[AI formula] full-profile analyze failed, using optimizer results:', analyzeErr.message);
        }

        const answer = formatAiFormulaAnswer(formulaData, breedLabel, phaseLabel, fullNutrients);
        setImmediate(() => logToMLA({ usr: reqUser, question, answer, source: 'formula',
          grounding: { breed: breedLabel, phase: phaseLabel, species: speciesCtx, ingredient_count: formulaRows.filter(r => r.inclusion > 0.01).length } }));
        return res.json({ ok: true, answer, formula_data: formulaData, model: 'nutrix-formula', source: 'formula' });

      } catch(fmlErr) {
        console.error('[AI formula] Error, falling through:', fmlErr.message);
        // Fall through to normal Q&A
      }
    }

    // ── Step 1: library lookup (with history fallback for follow-ups) ─────
    let parsed = parseLibraryQuery(question);
    // If the question is a simple intake change ("120" / "what if 120g"),
    // resolve breed/phase from conversation history
    if (!parsed?.entry && history.length) {
      const fromHistory = resolveFromHistory(question, history);
      if (fromHistory) parsed = fromHistory;
    }
    // If still no entry (e.g. follow-up like "at 100, 110 or 120 g" with no breed repeated),
    // inherit breed/species context from last matched library query in history
    if (parsed && !parsed.entry && parsed.isLibraryQuery && history.length) {
      const histCtx = getEntryFromHistory(history);
      if (histCtx) {
        parsed = {
          ...parsed,
          entry: histCtx.entry,
          phase: parsed.phase || histCtx.phase,   // current query phase wins; else keep history phase
        };
      }
    }

    // Context-driven upgrade: when the formulation workspace sends species/breed/stage context,
    // use it to (a) resolve a library entry when question alone didn't, or
    // (b) upgrade a generic question-match to a breed-specific one from context.
    if (context) {
      const ctxSpecies = String(context.species  || '').toLowerCase().trim();
      const ctxBreed   = String(context.breed    || '').toLowerCase().trim();
      const ctxStage   = String(context.stage    || context.production || context.phase || '').toLowerCase().trim();
      const ctxWorkLvl = String(context.work_level || '').toLowerCase().trim();
      const ctxSex = String(context.sex || '').toLowerCase().trim();
      if (ctxSpecies || ctxBreed) {
        // Build a synthetic question that carries the workspace context
        const syntheticQ = [ctxBreed, ctxSpecies, ctxWorkLvl || ctxStage, 'nutrient requirements'].filter(Boolean).join(' ');
        const ctxParsed = parseLibraryQuery(syntheticQ);
        if (ctxParsed?.entry) {
          // Use context entry when: no entry yet, OR context gives a more specific breed label
          const currentLabel = (parsed?.entry?.label || '').toLowerCase();
          const ctxLabel     = (ctxParsed.entry.label || '').toLowerCase();
          const contextIsMoreSpecific = ctxLabel !== currentLabel &&
            !ctxLabel.includes('generic') &&
            (currentLabel.includes('generic') || !parsed?.entry);
          if (!parsed?.entry || contextIsMoreSpecific) {
            parsed = {
              ...ctxParsed,
              phase: (parsed?.phase) || ctxParsed.phase || ctxStage || null,
              isLibraryQuery: true,
            };
          } else if (parsed?.entry && !parsed.phase && (ctxStage || ctxWorkLvl)) {
            // Same entry but question had no phase — inject phase from workspace stage
            parsed = { ...parsed, phase: ctxWorkLvl || ctxStage };
          }
        }
      }
      // For equine youth classes, the animal class always determines the primary phase group.
      // NRC 2007 foal/yearling tables apply regardless of which "stage" (growth/maintenance) the user picked.
      if (ctxSpecies === 'equine' && parsed?.entry) {
        const YOUTH_PHASE = { foal: 'foal', foal_donkey: 'foal', yearling: 'yearling' };
        const youthPhase = YOUTH_PHASE[ctxSex];
        if (youthPhase && (!parsed.phase || parsed.phase === 'maintenance' || parsed.phase === 'growth')) {
          parsed = { ...parsed, phase: youthPhase };
        }
      }
    }

    let libraryAnswer = null;
    let libraryContext = "";
    let mandatoryNotice = ""; // Always prepended to final answer; LLM cannot remove it

    if (parsed?.entry) {
      const { entry, resolvedFrom } = parsed;
      // When the workspace has an explicit phase selected (context.phase), and the
      // text-based phase came only from week-inference (not a direct keyword like "peak lay"),
      // trust the workspace selection — it's the authoritative current context.
      const contextPhase = (context.phase && typeof context.phase === 'string') ? context.phase.trim() : null;
      const phase = (parsed.phaseFromWeekInference && contextPhase) ? contextPhase : parsed.phase;
      // Inherit feed intake from history ONLY when current query has no gram mention at all.
      // If the query contains any "NNN g/gm/gram" pattern, trust what the user typed — never override with history.
      const currentQueryHasGrams = /\d+\s*(?:gm|g(?:rams?)?\b)/i.test(question);
      const allIntakes = detectAllIntakes(question);
      const dailyIntakeG = (allIntakes.length === 1 ? allIntakes[0] : parsed.dailyIntakeG)
        || (!currentQueryHasGrams ? getLastIntakeFromHistory(history) : null);

      if (entry.structType === "no_library") {
        // Try requirements engine first (dog, cat, shrimp, salmon, tilapia, catfish)
        if (isNutrientRequirementQuery(question)) {
          const staticReqs = loadEngineStaticRequirements(entry.species);
          if (staticReqs) {
            const match = matchRequirementsPhase(staticReqs, question);
            if (match) libraryAnswer = formatEngineRequirementsAnswer(match.data, entry.label);
          }
        }
        // Fall back to static text if engine didn't find a match
        if (!libraryAnswer) libraryAnswer = NO_LIBRARY_FALLBACKS[entry.species] || null;
      } else if (entry.structType === "performance_library") {
        const _isNutrientQ = isNutrientRequirementQuery(question);
        // Only treat as a performance query when it is EXPLICITLY about production
        // metrics AND has no nutrient signals — never let performance bleed into nutrition answers.
        const _isPerfQ = isPerformanceQuery(question) && !_isNutrientQ;

        // Explicit performance query → show production performance ONLY
        if (_isPerfQ) {
          const data = readJson(entry.file);
          const profiles = selectProfiles(data, entry, phase);
          if (profiles.length && profiles[0]._perfType) {
            libraryAnswer = formatPerformanceAnswer(profiles[0]._breedData, entry.label);
          }
        }

        // Nutrient query OR ambiguous query → always try requirements engine first.
        // Nutrients and production performance must NEVER be mixed in the same answer.
        if (!libraryAnswer && (_isNutrientQ || !_isPerfQ)) {
          const staticReqs = loadEngineStaticRequirements(entry.species);
          if (staticReqs) {
            let match = matchRequirementsPhase(staticReqs, question);
            if (!match) match = matchRequirementsPhase(staticReqs, question, true);
            if (match) libraryAnswer = formatEngineRequirementsAnswer(match.data, entry.label);
          }
          if (!libraryAnswer) libraryAnswer = NO_LIBRARY_FALLBACKS[entry.species] || null;
        }

        // Last resort for explicit-performance-only queries that had no library match
        if (!libraryAnswer && _isPerfQ) {
          const data = readJson(entry.file);
          const profiles = selectProfiles(data, entry, phase);
          if (profiles.length && profiles[0]._perfType) {
            libraryAnswer = formatPerformanceAnswer(profiles[0]._breedData, entry.label);
          }
        }
      } else {
        // ── Universal performance lookup (poultry, swine, any profiles_* structType) ──
        const _isPurePerf = isPerformanceQuery(question) && !isNutrientRequirementQuery(question);
        if (_isPurePerf) {
          const perfData = _lookupBreedPerf(entry.breedFilter, entry.label, question);
          if (perfData) {
            libraryAnswer = formatPerformanceAnswer(perfData, entry.label);
          }
        }

        // Nutrient requirements block — NEVER shown for pure performance queries
        if (!libraryAnswer && !_isPurePerf) {
        const data = readJson(entry.file);
        const profiles = selectProfiles(data, entry, phase);
        const phaseDisplay = phase ? phase.replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase()) : null;
        const titleParts = [entry.label, phaseDisplay].filter(Boolean);
        const displayTitle = titleParts.join(" – ");
        if (profiles.length) {
          // Multiple intake comparison (e.g. "at 100, 110 or 120 g")
          if (allIntakes.length > 1) {
            libraryAnswer = formatMultiIntakeComparison(profiles, displayTitle, allIntakes);
          } else {
            libraryAnswer = formatRequirementsAnswer(profiles, displayTitle, dailyIntakeG);
          }
          // Extract data-gap notices from profiles so they survive LLM rewriting
          const noticeAdded = new Set();
          for (const p of profiles) {
            if (p._genericFallbackReason && !noticeAdded.has(p._requestedBreed)) {
              noticeAdded.add(p._requestedBreed);
              const breedDisplay = entry.label || (p._requestedBreed || "").replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
              mandatoryNotice += `> ⚠️ **Data gap — ${breedDisplay}:** ${p._genericFallbackReason}. Values shown are **generic commercial targets**, not ${breedDisplay}-specific. Breed-specific data needs to be added to the Nutrix library from the official breeder guide.\n\n`;
            }
          }
        } else {
          // File exists but no profiles matched (e.g., empty shell breed file)
          const breedDisplay = (entry.breedFilter || entry.label || "").replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
          mandatoryNotice = `> ⚠️ **Library gap — ${breedDisplay}:** The Nutrix library has a placeholder entry for ${breedDisplay} but it contains no nutrient data yet. The values below (if any) are from general knowledge, not the Nutrix library. Accurate ${breedDisplay}-specific data must come from the official breed management guide.\n\n`;
          libraryAnswer = null; // No library data — let LLM answer from training knowledge with the notice above
        }
        } // end if (!libraryAnswer) nutrient block
      }

      if (libraryAnswer) {
        const intakeNote = dailyIntakeG
          ? `\nFeed intake: ${dailyIntakeG} g/bird/day (${parsed.dailyIntakeG ? 'specified in current query' : 'carried forward from previous query in this conversation'}). Use ONLY this value — do NOT substitute any default intake. The library section already shows calculated daily intakes — confirm and present them clearly for the user.`
          : "\nFeed intake: not specified. Do NOT invent or assume a default intake value (e.g. do not add 'Based on 100 g/hen/day' unless the user stated it).";
        const historyNote = parsed.resolvedFrom
          ? `\nContext resolved from prior question: "${parsed.resolvedFrom}"`
          : "";
        libraryContext = `\n\n[NUTRIX LIBRARY DATA — authoritative, use these numbers in your response${intakeNote}${historyNote}]\n${libraryAnswer}`;
      }
    }

    // ── Step 2: library data found → return directly (LLM cannot improve on exact numbers) ──
    const hasApiKey = Boolean(process.env.OPENAI_API_KEY) && process.env.OPENAI_API_KEY !== "mock";

    // Any library answer (with or without data gap notice) is returned directly.
    // The LLM is only used when there is NO library match at all.
    if (libraryAnswer || mandatoryNotice) {
      const answer = mandatoryNotice ? mandatoryNotice + (libraryAnswer || "") : libraryAnswer;
      setImmediate(() => logToMLA({ usr: reqUser, question, answer, source: 'library',
        grounding: { species: context.species, breed: context.breed, phase: context.phase } }));
      return res.json({ ok:true, answer, model:"nutrix-library", source:"library" });
    }

    if (!hasApiKey) {
      // Enhanced keyword fallback for non-library questions
      const q = question.toLowerCase();
      if (guideHit && guideHit.score >= 4) {
        const answer = formatFeatureAnswer(guideHit.feature);
        setImmediate(() => logToMLA({ usr: reqUser, question, answer, source: 'manual',
          grounding: { species: context.species, breed: context.breed } }));
        return res.json({ ok:true, answer, model:"nutrix-manual", source:"manual" });
      }
      let answer;
      if (/amino acid|limiting/i.test(q)) answer = "Lysine is typically the first limiting amino acid in corn-soy broiler diets, followed by Met+Cys, then Threonine. Use SID (standardised ileal digestibility) basis for precision formulation.";
      else if (/cost.*reduc|reduc.*cost/i.test(q)) answer = "Feed cost reduction: use LP optimization, price-sensitive ingredient substitution, monitor price volatility, adjust phase boundaries to actual flock performance, and maximise use of co-products within safety limits.";
      else if (/phytase/i.test(q)) answer = "Phytase (500 FTU/kg) releases ~0.10–0.12% avP equivalent from plant phytate, allowing reduction of inorganic P and improved cost efficiency.";
      else answer = `Nutrix AI: Ask me about any animal species — broiler, layer, turkey, duck, quail, goose, swine, horse, sheep, goat, dairy, shrimp, dog, cat, and more. Example: "Ross 308 starter nutrients", "swine nursery requirements", "Lohmann Brown peak lay", "horse maintenance requirements", "shrimp protein requirements".`;
      setImmediate(() => logToMLA({ usr: reqUser, question, answer, source: 'mock',
        grounding: { species: context.species, breed: context.breed } }));
      return res.json({ ok:true, answer, model:"nutrix-smart-mock" });
    }

    // ── Step 3: call AI with library context ──────────────────────────────
    const client = makeClient();
    // Inject Nutrix feature guide context for how-to/help questions
    const featureGuideContext = findFeatureGuideContext(question) || "";
    const systemPrompt = `You are Nutrix AI, the expert animal nutrition and feed formulation assistant embedded in Nutrix feed mill software.

You have deep expertise in nutrition requirements for all animal species: broiler chickens, laying hens, breeders, turkeys, ducks, quail, geese, pheasants, swine, dairy cattle, beef cattle, sheep, goats, horses, aquaculture (shrimp, salmon, tilapia), dogs, and cats.

When library data is provided below, use it as the authoritative source. Present values clearly in a structured table or bullet format with units. Add brief nutritionist-level interpretation.

IMPORTANT: If the library data includes a ⚠️ data gap notice, you MUST acknowledge it explicitly. NEVER present generic data as if it were breed-specific. If a specific breed like Dekalb White, Lohmann Brown, or ISA Brown has no dedicated library entry, clearly state this limitation and note that you are providing general commercial layer guidelines as reference only.

When no library data is available, draw on your training knowledge of NRC, AAFCO, NASEM, Aviagen, Cobb, and other breed management guides to provide accurate, practical guidance.

For non-nutrition questions, answer as a knowledgeable general assistant.

If a Nutrix Feature section is provided below, treat it as the product manual. Answer how-to questions with exact tab names, buttons, and steps from that manual. Do not invent other menus.${libraryContext}${featureGuideContext}`.trim();

    // Build conversation turns from history (last 6 messages, skip empty)
    const historyTurns = history
      .filter(m => m.text?.trim())
      .slice(-6)
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text
      }));

    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role:"system", content:systemPrompt },
        ...historyTurns,
        { role:"user",   content: question }
      ],
      temperature: 0.3,
      max_tokens: 1400
    });

    const rawAnswer = response.choices?.[0]?.message?.content || libraryAnswer || "";
    const answer = mandatoryNotice ? mandatoryNotice + rawAnswer : rawAnswer;
    const finalSource = libraryAnswer ? "library+ai" : "ai";

    setImmediate(() => logToMLA({ usr: reqUser, question, answer, source: finalSource,
      grounding: { species: context.species, breed: context.breed, phase: context.phase,
        library_grounded: !!libraryAnswer, model: DEFAULT_MODEL } }));

    return res.json({
      ok:true, answer, model:DEFAULT_MODEL,
      channel:context.channel, context_used:context,
      source: finalSource
    });

  } catch (err) {
    console.error("[Nutrix AI] ask failed:", err);
    return res.status(500).json({ ok:false, error:"Nutrix AI request failed", detail: err?.message||String(err) });
  }
});

router.post("/recommend", async (req, res) => {
  try {
    const formulaRows = Array.isArray(req.body?.formula_rows) ? req.body.formula_rows : [];
    const bindingConstraints = Array.isArray(req.body?.binding_constraints) ? req.body.binding_constraints : [];
    const ingredientBoundStatus = Array.isArray(req.body?.ingredient_bound_status) ? req.body.ingredient_bound_status : [];
    const sensitivityRows = Array.isArray(req.body?.sensitivity_perturbation_rows) ? req.body.sensitivity_perturbation_rows : [];

    if (!formulaRows.length) return res.status(400).json({ ok:false, error:"formula_rows is required" });

    const recommendations = buildRuleBasedRecommendations({ formulaRows, bindingConstraints, ingredientBoundStatus, sensitivityRows });
    const hasApiKey = Boolean(process.env.OPENAI_API_KEY) && process.env.OPENAI_API_KEY !== "mock";

    if (!hasApiKey || !recommendations.length) {
      return res.json({ ok:true, recommendations, narrative:"", model:"rule-based" });
    }

    const context = compactContext(req.body?.context || {});
    const client = makeClient();
    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role:"system", content:"You are Nutrix AI, a feed formulation assistant. Turn the provided cost/nutrient observations into 2–4 short, practical, plain-language ingredient-swap or sourcing recommendations for a feed mill nutritionist. Be specific. Do not invent data." },
        { role:"user",   content:JSON.stringify({ context, recommendations }, null, 2) }
      ],
      temperature: 0.4,
      max_tokens: 600
    });

    return res.json({ ok:true, recommendations, narrative:response.choices?.[0]?.message?.content||"", model:DEFAULT_MODEL });

  } catch (err) {
    console.error("[Nutrix AI] recommend failed:", err);
    return res.status(500).json({ ok:false, error:"Nutrix AI recommendation request failed", detail:err?.message||String(err) });
  }
});

export default router;
