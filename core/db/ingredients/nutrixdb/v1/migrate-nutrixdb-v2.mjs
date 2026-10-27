// migrate-nutrixdb-v2.mjs
// Run: node migrate-nutrixdb-v2.mjs
// from: nutripilot-agrocore/core/db/ingredients/nutrixdb/v1/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'nutrixdb.ingredients.v1.json');
const BAK_PATH  = path.join(__dirname, `nutrixdb.ingredients.v1.bak_${new Date().toISOString().replace(/[:.]/g,'-')}.json`);

// ── SOURCE REF CONSTANTS ─────────────────────────────────────────────────────
const SRC = {
  poultry : 'Rostagno_2022_5ed_BrazilianTables',
  equine  : 'NRC_2007_Equine',
  equine_x: 'NRC_2007_Equine|Extension_TBD',
  swine   : 'PIC_2021_NutrientRecommendations_Generic',
};

// Equine ingredients sourced partly from extension (not pure NRC)
const EQUINE_EXT_KEYS = new Set([
  'fescue_hay','bluegrass_hay','ryegrass_hay','alfalfa_pellets',
  'tall_fescue_hay','pasture_cool_season_vegetative',
  'pasture_cool_season_mature','pasture_warm_season',
  'pasture_grass_temperate','pasture_grass_tropical',
]);

// Flat raw fields on equine ingredients that are duplicated by _pct / _ppm versions
const EQUINE_RAW_DUPES = new Set([
  'cp','ee','cf','ash','ndf','adf','ca','mg','na','cl','k','s',
  'fe','zn','mn','cu','se','starch','sugars','total_p',
  'moisture',
]);

// ── LOAD ─────────────────────────────────────────────────────────────────────
console.log('📂 Loading NutrixDB...');
const raw  = fs.readFileSync(DB_PATH, 'utf8');
const root = JSON.parse(raw);
const db   = root.db;

// ── BACKUP ───────────────────────────────────────────────────────────────────
fs.writeFileSync(BAK_PATH, raw, 'utf8');
console.log(`💾 Backup → ${path.basename(BAK_PATH)}`);

// ── PASS 1 — stamp existing ingredients ──────────────────────────────────────
let renamed = 0, stamped = 0, cleaned = 0;

for (const [key, ing] of Object.entries(db)) {
  const isEquine  = ing.species_compatibility?.includes('equine')  && !ing.species_compatibility?.includes('poultry');
  const isPoultry = ing.species_compatibility?.includes('poultry') && !ing.species_compatibility?.includes('equine');
  const isBoth    = ing.species_compatibility?.includes('poultry') && ing.species_compatibility?.includes('equine');

  // 1a. rename source → source_ref
  if (ing.source && !ing.source_ref) {
    ing.source_ref = ing.source;
    delete ing.source;
    renamed++;
  }

  // 1b. stamp missing source_ref
  if (!ing.source_ref) {
    if (isEquine)        ing.source_ref = EQUINE_EXT_KEYS.has(key) ? SRC.equine_x : SRC.equine;
    else if (isPoultry)  ing.source_ref = SRC.poultry;
    else if (isBoth)     ing.source_ref = `${SRC.equine}|${SRC.poultry}`;
    stamped++;
  }

  // 1c. fix poultry source strings that are vague
  if (ing.source_ref === 'br_tables_carried_to_us_no_guess') {
    ing.source_ref = SRC.poultry;
  }

  // 1d. add nutrient_basis
  if (!ing.nutrient_basis) {
    ing.nutrient_basis = isEquine ? 'dm' : 'as_fed';
  }

  // 1e. clean equine duplicate raw fields
  if (isEquine) {
    for (const f of EQUINE_RAW_DUPES) {
      if (f in ing) { delete ing[f]; cleaned++; }
    }
  }
}

console.log(`✏️  source renamed  : ${renamed}`);
console.log(`🏷️  source stamped  : ${stamped}`);
console.log(`🧹 dupe fields removed: ${cleaned}`);

// ── PASS 2 — add swine ingredients ───────────────────────────────────────────
// NE kcal/kg | CP/Ca/P = % as-fed | SID AA = % | STTD_P = %
// Source: PIC 2021 Nutrition Guidelines + NRC 2012 feed composition

const swineIngredients = {

  corn_grain_swine: {
    display_name: 'Corn (Grain) — Swine',
    category: 'cereal_grain', ingredient_type: 'grain',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 88.0, ne: 2193, me: 3381,
    cp: 8.5, ee: 3.8, cf: 2.2, ash: 1.3,
    ndf: 11.5, adf: 3.5,
    ca: 0.03, p_total: 0.28, sttd_p: 0.08,
    na: 0.02, cl: 0.05, k: 0.37, mg: 0.11,
    sid_lys: 0.19, sid_met: 0.17, sid_met_cys: 0.30,
    sid_thr: 0.27, sid_trp: 0.05, sid_val: 0.37,
    sid_ile: 0.24, sid_leu: 0.82, sid_his: 0.20,
    sid_phe: 0.33, sid_arg: 0.35,
    zn_ppm: 18, fe_ppm: 30, mn_ppm: 5, cu_ppm: 2, se_ppm: 0.03,
  },

  soybean_meal_46_swine: {
    display_name: 'Soybean Meal 46.5% CP — Swine',
    category: 'protein_supplement', ingredient_type: 'protein_supplement',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 89.0, ne: 1690, me: 2230,
    cp: 46.5, ee: 1.8, cf: 3.5, ash: 6.2,
    ndf: 14.5, adf: 8.5,
    ca: 0.29, p_total: 0.65, sttd_p: 0.24,
    na: 0.04, cl: 0.05, k: 2.00, mg: 0.28,
    sid_lys: 2.81, sid_met: 0.62, sid_met_cys: 1.25,
    sid_thr: 1.72, sid_trp: 0.57, sid_val: 2.04,
    sid_ile: 2.07, sid_leu: 3.36, sid_his: 1.18,
    sid_phe: 2.23, sid_arg: 3.26,
    zn_ppm: 28, fe_ppm: 120, mn_ppm: 28, cu_ppm: 15, se_ppm: 0.10,
  },

  wheat_grain_swine: {
    display_name: 'Wheat (Grain) — Swine',
    category: 'cereal_grain', ingredient_type: 'grain',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 88.0, ne: 2107, me: 3260,
    cp: 13.5, ee: 1.8, cf: 2.8, ash: 1.7,
    ndf: 16.0, adf: 4.5,
    ca: 0.06, p_total: 0.38, sttd_p: 0.14,
    na: 0.02, cl: 0.05, k: 0.45, mg: 0.13,
    sid_lys: 0.33, sid_met: 0.21, sid_met_cys: 0.47,
    sid_thr: 0.37, sid_trp: 0.14, sid_val: 0.53,
    sid_ile: 0.40, sid_leu: 0.86, sid_his: 0.29,
    sid_phe: 0.60, sid_arg: 0.57,
    zn_ppm: 30, fe_ppm: 40, mn_ppm: 35, cu_ppm: 5, se_ppm: 0.05,
  },

  barley_grain_swine: {
    display_name: 'Barley (Grain) — Swine',
    category: 'cereal_grain', ingredient_type: 'grain',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 88.0, ne: 1980, me: 3050,
    cp: 12.0, ee: 1.9, cf: 5.0, ash: 2.3,
    ndf: 20.0, adf: 6.5,
    ca: 0.06, p_total: 0.35, sttd_p: 0.14,
    na: 0.03, cl: 0.15, k: 0.50, mg: 0.13,
    sid_lys: 0.38, sid_met: 0.19, sid_met_cys: 0.40,
    sid_thr: 0.36, sid_trp: 0.12, sid_val: 0.52,
    sid_ile: 0.36, sid_leu: 0.73, sid_his: 0.24,
    sid_phe: 0.55, sid_arg: 0.52,
    zn_ppm: 18, fe_ppm: 50, mn_ppm: 14, cu_ppm: 5, se_ppm: 0.05,
  },

  wheat_bran_swine: {
    display_name: 'Wheat Bran — Swine',
    category: 'by_product', ingredient_type: 'by_product',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 88.0, ne: 1100, me: 1505,
    cp: 15.5, ee: 3.8, cf: 9.0, ash: 5.5,
    ndf: 43.0, adf: 12.5,
    ca: 0.14, p_total: 1.18, sttd_p: 0.32,
    na: 0.04, cl: 0.05, k: 1.20, mg: 0.52,
    sid_lys: 0.55, sid_met: 0.19, sid_met_cys: 0.43,
    sid_thr: 0.46, sid_trp: 0.18, sid_val: 0.65,
    sid_ile: 0.44, sid_leu: 0.93, sid_his: 0.37,
    sid_phe: 0.58, sid_arg: 0.97,
    zn_ppm: 90, fe_ppm: 130, mn_ppm: 120, cu_ppm: 12, se_ppm: 0.08,
  },

  soybean_oil_swine: {
    display_name: 'Soybean Oil — Swine',
    category: 'fat_oil', ingredient_type: 'fat_oil',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 100.0, ne: 7440, me: 8790,
    cp: 0, ee: 99.0, cf: 0, ash: 0,
    ca: 0, p_total: 0, sttd_p: 0,
    sid_lys: 0, sid_met: 0, sid_thr: 0, sid_trp: 0,
  },

  fish_meal_65_swine: {
    display_name: 'Fish Meal 65% CP — Swine',
    category: 'animal_protein', ingredient_type: 'animal_protein',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 92.0, ne: 2580, me: 3150,
    cp: 65.0, ee: 9.0, cf: 0.5, ash: 14.0,
    ca: 3.80, p_total: 2.50, sttd_p: 2.25,
    na: 0.90, cl: 0.80, k: 0.80, mg: 0.18,
    sid_lys: 4.80, sid_met: 1.70, sid_met_cys: 2.20,
    sid_thr: 2.60, sid_trp: 0.60, sid_val: 3.00,
    sid_ile: 2.50, sid_leu: 4.60, sid_his: 1.40,
    sid_phe: 2.50, sid_arg: 3.60,
    zn_ppm: 90, fe_ppm: 180, mn_ppm: 8, cu_ppm: 4, se_ppm: 1.50,
  },

  canola_meal_swine: {
    display_name: 'Canola Meal — Swine',
    category: 'protein_supplement', ingredient_type: 'protein_supplement',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 90.0, ne: 1530, me: 2380,
    cp: 37.5, ee: 3.5, cf: 10.5, ash: 6.5,
    ndf: 28.0, adf: 18.0,
    ca: 0.65, p_total: 1.05, sttd_p: 0.35,
    na: 0.08, cl: 0.10, k: 1.30, mg: 0.45,
    sid_lys: 1.81, sid_met: 0.63, sid_met_cys: 1.38,
    sid_thr: 1.35, sid_trp: 0.40, sid_val: 1.70,
    sid_ile: 1.38, sid_leu: 2.45, sid_his: 0.88,
    sid_phe: 1.38, sid_arg: 1.89,
    zn_ppm: 55, fe_ppm: 180, mn_ppm: 45, cu_ppm: 4, se_ppm: 0.20,
  },

  dried_whey_swine: {
    display_name: 'Dried Whey — Swine',
    category: 'dairy_product', ingredient_type: 'dairy_product',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 95.0, ne: 2580, me: 3350,
    cp: 12.5, ee: 1.0, cf: 0.2, ash: 8.5,
    ca: 0.87, p_total: 0.72, sttd_p: 0.65,
    na: 0.65, cl: 1.10, k: 1.50, mg: 0.11,
    sid_lys: 0.92, sid_met: 0.19, sid_met_cys: 0.35,
    sid_thr: 0.71, sid_trp: 0.15, sid_val: 0.60,
    sid_ile: 0.58, sid_leu: 1.08, sid_his: 0.17,
    sid_phe: 0.34, sid_arg: 0.26,
    lactose_pct: 63.0,
  },

  blood_meal_swine: {
    display_name: 'Blood Meal (Spray Dried) — Swine',
    category: 'animal_protein', ingredient_type: 'animal_protein',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 93.0, ne: 2650, me: 3250,
    cp: 90.0, ee: 0.8, cf: 0.5, ash: 4.5,
    ca: 0.30, p_total: 0.22, sttd_p: 0.18,
    na: 0.35, cl: 0.30, k: 0.10, mg: 0.02,
    sid_lys: 6.80, sid_met: 0.80, sid_met_cys: 1.10,
    sid_thr: 3.20, sid_trp: 1.00, sid_val: 5.50,
    sid_ile: 0.55, sid_leu: 9.50, sid_his: 4.80,
    sid_phe: 5.20, sid_arg: 3.20,
  },

  meat_bone_meal_swine: {
    display_name: 'Meat & Bone Meal 50% CP — Swine',
    category: 'animal_protein', ingredient_type: 'animal_protein',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 93.0, ne: 1580, me: 2290,
    cp: 50.0, ee: 8.5, cf: 2.0, ash: 26.0,
    ca: 9.80, p_total: 4.80, sttd_p: 3.84,
    na: 0.65, cl: 0.70, k: 0.50, mg: 0.25,
    sid_lys: 2.40, sid_met: 0.62, sid_met_cys: 0.95,
    sid_thr: 1.50, sid_trp: 0.17, sid_val: 2.15,
    sid_ile: 1.40, sid_leu: 2.85, sid_his: 0.75,
    sid_phe: 1.55, sid_arg: 2.85,
  },

  limestone_swine: {
    display_name: 'Limestone — Swine',
    category: 'mineral', ingredient_type: 'mineral',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 100.0, ne: 0, me: 0, cp: 0,
    ca: 38.5, p_total: 0.02, sttd_p: 0,
    na: 0.06, mg: 0.40,
  },

  monocalcium_phosphate_swine: {
    display_name: 'Monocalcium Phosphate — Swine',
    category: 'mineral', ingredient_type: 'mineral',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 100.0, ne: 0, me: 0, cp: 0,
    ca: 16.0, p_total: 22.0, sttd_p: 22.0,
  },

  dicalcium_phosphate_swine: {
    display_name: 'Dicalcium Phosphate — Swine',
    category: 'mineral', ingredient_type: 'mineral',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 100.0, ne: 0, me: 0, cp: 0,
    ca: 22.0, p_total: 18.0, sttd_p: 17.1,
  },

  salt_swine: {
    display_name: 'Salt (NaCl) — Swine',
    category: 'mineral', ingredient_type: 'mineral',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 100.0, ne: 0, me: 0, cp: 0,
    ca: 0, p_total: 0, sttd_p: 0,
    na: 39.3, cl: 60.7,
  },

  l_lys_hcl_swine: {
    display_name: 'L-Lysine HCl — Swine',
    category: 'synthetic_aa', ingredient_type: 'synthetic_aa',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    invariant: true,
    dm_pct: 99.0, ne: 0, me: 0, cp: 0,
    total_lys: 78.8, sid_lys: 78.8, sid_coef_lys: 100,
  },

  dl_met_swine: {
    display_name: 'DL-Methionine — Swine',
    category: 'synthetic_aa', ingredient_type: 'synthetic_aa',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    invariant: true,
    dm_pct: 99.0, ne: 0, me: 0, cp: 0,
    total_met: 99.0, sid_met: 99.0, sid_coef_met: 100,
  },

  l_thr_swine: {
    display_name: 'L-Threonine — Swine',
    category: 'synthetic_aa', ingredient_type: 'synthetic_aa',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    invariant: true,
    dm_pct: 99.0, ne: 0, me: 0, cp: 0,
    total_thr: 98.5, sid_thr: 98.5, sid_coef_thr: 100,
  },

  l_trp_swine: {
    display_name: 'L-Tryptophan — Swine',
    category: 'synthetic_aa', ingredient_type: 'synthetic_aa',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    invariant: true,
    dm_pct: 99.0, ne: 0, me: 0, cp: 0,
    total_trp: 98.0, sid_trp: 98.0, sid_coef_trp: 100,
  },

  l_val_swine: {
    display_name: 'L-Valine — Swine',
    category: 'synthetic_aa', ingredient_type: 'synthetic_aa',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    invariant: true,
    dm_pct: 99.0, ne: 0, me: 0, cp: 0,
    total_val: 98.5, sid_val: 98.5, sid_coef_val: 100,
  },

  vit_min_premix_swine: {
    display_name: 'Vitamin + Mineral Premix — Swine',
    category: 'premix', ingredient_type: 'premix',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    nutritive: false,
    dm_pct: 100.0, ne: 0, me: 0, cp: 0,
    ca: 0, p_total: 0, sttd_p: 0,
    sid_lys: 0, sid_met: 0, sid_thr: 0, sid_trp: 0,
  },

  phytase_swine: {
    display_name: 'Phytase — Swine',
    category: 'enzyme', ingredient_type: 'enzyme',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    nutritive: false,
    dm_pct: 100.0, ne: 0, me: 0, cp: 0,
    ca: 0, p_total: 0, sttd_p: 0,
    matrix_sttd_p: 0.12,  // phytase P matrix value per 500 FTU
    matrix_ca: 0.13,
  },

  sugar_swine: {
    display_name: 'Sugar (Sucrose) — Swine',
    category: 'energy_supplement', ingredient_type: 'energy_supplement',
    species_compatibility: ['swine'],
    nutrient_basis: 'as_fed', source_ref: SRC.swine,
    dm_pct: 99.5, ne: 2760, me: 3720,
    cp: 0, ee: 0, cf: 0, ash: 0.1,
    ca: 0, p_total: 0, sttd_p: 0,
    sucrose_pct: 99.5,
  },

};

// Merge swine into db
let swineAdded = 0;
for (const [key, ing] of Object.entries(swineIngredients)) {
  if (db[key]) {
    console.warn(`⚠️  Key collision: ${key} already exists — skipping`);
  } else {
    db[key] = ing;
    swineAdded++;
  }
}

console.log(`🐷 Swine ingredients added: ${swineAdded}`);

// ── WRITE ─────────────────────────────────────────────────────────────────────
const output = JSON.stringify({ db }, null, 2);
fs.writeFileSync(DB_PATH, output, 'utf8');

console.log('\n✅ NutrixDB v2 migration complete');
console.log(`   Total ingredients: ${Object.keys(db).length}`);
console.log(`   Poultry: ${Object.values(db).filter(i => i.species_compatibility?.includes('poultry')).length}`);
console.log(`   Equine : ${Object.values(db).filter(i => i.species_compatibility?.includes('equine')).length}`);
console.log(`   Swine  : ${Object.values(db).filter(i => i.species_compatibility?.includes('swine')).length}`);
console.log('\n⚠️  Next steps:');
console.log('   1. Update SPECIES_PROFILE_ROUTER.cjs → point all species at nutrixdb');
console.log('   2. Update LOAD_INGREDIENTS.cjs → filter by species_compatibility');
console.log('   3. Update equine_ext source_ref once extension sources confirmed');