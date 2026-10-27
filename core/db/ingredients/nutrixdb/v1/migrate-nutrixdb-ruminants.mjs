/**
 * NutrixDB Ruminant Migration v1
 * Adds Dairy, Beef, Sheep, Goat ingredients to nutrixdb.ingredients.v1.json
 * Run: node migrate-nutrixdb-ruminants.mjs
 *
 * Sources:
 * - NRC_2001_Dairy: Nutrient Requirements of Dairy Cattle (7th ed, 2001)
 * - NRC_2000_Beef: Nutrient Requirements of Beef Cattle (7th ed, 2000)
 * - NRC_2007_SmallRuminants: Nutrient Requirements of Small Ruminants (2007)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Path to NutrixDB ──────────────────────────────────────────────────────────
const DB_PATH = "C:/Users/Administrator/My Drive/NutriPilot/nutripilot-agrocore/core/db/ingredients/nutrixdb/v1/nutrixdb.ingredients.v1.json";

// ── Ruminant Ingredients ──────────────────────────────────────────────────────
const RUMINANT_INGREDIENTS = {

  // ═══════════════════════════════════════════════════════════════════════════
  // DAIRY CATTLE — NEL/MP/RDP/RUP system (NRC 2001)
  // ═══════════════════════════════════════════════════════════════════════════

  "corn_grain_dairy": {
    display_name: "Corn (Grain) — Dairy",
    category: "cereal_grain",
    ingredient_type: "grain",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 88.0, cp: 8.5, ee: 3.8, cf: 2.2, ash: 1.3, ndf: 11.5, adf: 3.5,
    nel_mcal_kg: 2.01, nem_mcal_kg: 1.96, neg_mcal_kg: 1.29, me: 3.38, tdn: 88.0,
    rdp_pct: 60.0, rup_pct: 40.0,
    ca: 0.03, p_total: 0.28, na: 0.02, k: 0.37, mg: 0.11, s: 0.11, cl: 0.05,
    total_lys: 0.25, total_met: 0.17, total_thr: 0.29, total_trp: 0.06,
    total_arg: 0.37, total_val: 0.40, total_ile: 0.27, total_leu: 0.95,
    zn_ppm: 18, fe_ppm: 30, mn_ppm: 5, cu_ppm: 2, se_ppm: 0.03
  },

  "soybean_meal_48_dairy": {
    display_name: "Soybean Meal 48% CP — Dairy",
    category: "protein_meal",
    ingredient_type: "oilseed_meal",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 89.0, cp: 48.5, ee: 1.5, cf: 3.5, ash: 6.5, ndf: 8.0, adf: 5.0,
    nel_mcal_kg: 2.00, nem_mcal_kg: 1.95, neg_mcal_kg: 1.29, me: 3.20, tdn: 84.0,
    rdp_pct: 65.0, rup_pct: 35.0,
    ca: 0.27, p_total: 0.65, na: 0.03, k: 2.20, mg: 0.28, s: 0.42,
    total_lys: 2.90, total_met: 0.62, total_thr: 1.82, total_trp: 0.65,
    total_arg: 3.40, total_val: 2.15, total_ile: 2.10, total_leu: 3.60,
    zn_ppm: 45, fe_ppm: 120, mn_ppm: 28, cu_ppm: 15, se_ppm: 0.10
  },

  "alfalfa_hay_dairy": {
    display_name: "Alfalfa Hay — Dairy",
    category: "forage",
    ingredient_type: "hay",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 89.0, cp: 18.0, ee: 2.5, cf: 28.0, ash: 9.5, ndf: 40.0, adf: 30.0,
    nel_mcal_kg: 1.41, nem_mcal_kg: 1.37, neg_mcal_kg: 0.79, me: 2.30, tdn: 60.0,
    pendf_factor: 1.0, rdp_pct: 72.0, rup_pct: 28.0,
    ca: 1.40, p_total: 0.23, na: 0.09, k: 2.60, mg: 0.30, s: 0.30,
    total_lys: 0.80, total_met: 0.22, total_thr: 0.72, total_trp: 0.21, total_arg: 0.78,
    zn_ppm: 25, fe_ppm: 180, mn_ppm: 32, cu_ppm: 9, se_ppm: 0.15
  },

  "corn_silage_dairy": {
    display_name: "Corn Silage — Dairy",
    category: "forage",
    ingredient_type: "silage",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 32.0, cp: 8.5, ee: 3.2, cf: 22.0, ash: 4.2, ndf: 45.0, adf: 28.0,
    nel_mcal_kg: 0.57, nem_mcal_kg: 0.54, neg_mcal_kg: 0.33, me: 0.94, tdn: 70.0,
    pendf_factor: 0.48, rdp_pct: 62.0, rup_pct: 38.0,
    ca: 0.24, p_total: 0.21, na: 0.01, k: 1.10, mg: 0.16,
    zn_ppm: 18, fe_ppm: 90, mn_ppm: 18, cu_ppm: 3
  },

  "alfalfa_silage_dairy": {
    display_name: "Alfalfa Silage (Haylage) — Dairy",
    category: "forage",
    ingredient_type: "silage",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 45.0, cp: 17.0, ee: 3.0, cf: 27.0, ash: 10.0, ndf: 42.0, adf: 32.0,
    nel_mcal_kg: 0.62, nem_mcal_kg: 0.59, me: 1.05, tdn: 57.0,
    pendf_factor: 0.85, rdp_pct: 75.0, rup_pct: 25.0,
    ca: 1.30, p_total: 0.22, k: 2.40, mg: 0.28, s: 0.28
  },

  "cottonseed_whole_dairy": {
    display_name: "Cottonseed, Whole — Dairy",
    category: "oilseed",
    ingredient_type: "oilseed_whole",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 91.0, cp: 22.5, ee: 19.5, cf: 24.0, ash: 4.5, ndf: 45.0, adf: 34.0,
    nel_mcal_kg: 2.10, me: 3.30, tdn: 89.0,
    rdp_pct: 42.0, rup_pct: 58.0,
    ca: 0.14, p_total: 0.55, k: 1.20, mg: 0.38, s: 0.22,
    total_lys: 0.85, total_met: 0.33, total_arg: 2.60
  },

  "distillers_grains_dried_dairy": {
    display_name: "Distillers Grains, Dried (DDGS) — Dairy",
    category: "byproduct",
    ingredient_type: "fermentation_byproduct",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 89.0, cp: 28.0, ee: 10.5, cf: 8.5, ash: 5.5, ndf: 40.0, adf: 18.0,
    nel_mcal_kg: 2.06, me: 3.42, tdn: 87.0,
    rdp_pct: 45.0, rup_pct: 55.0,
    ca: 0.22, p_total: 0.83, na: 0.40, k: 1.05, mg: 0.32, s: 0.55,
    total_lys: 0.85, total_met: 0.55, total_thr: 1.02, total_trp: 0.22, total_arg: 1.22,
    zn_ppm: 75, cu_ppm: 12
  },

  "canola_meal_dairy": {
    display_name: "Canola Meal — Dairy",
    category: "protein_meal",
    ingredient_type: "oilseed_meal",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 90.0, cp: 38.0, ee: 3.5, cf: 11.5, ash: 7.0, ndf: 28.0, adf: 19.0,
    nel_mcal_kg: 1.72, me: 2.86, tdn: 73.0,
    rdp_pct: 65.0, rup_pct: 35.0,
    ca: 0.67, p_total: 1.12, na: 0.12, k: 1.30, mg: 0.52, s: 0.68,
    total_lys: 2.10, total_met: 0.74, total_thr: 1.62, total_arg: 2.32,
    zn_ppm: 60, cu_ppm: 7
  },

  "wheat_bran_dairy": {
    display_name: "Wheat Bran — Dairy",
    category: "byproduct",
    ingredient_type: "milling_byproduct",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 88.0, cp: 16.5, ee: 4.0, cf: 11.5, ash: 6.0, ndf: 46.0, adf: 13.0,
    nel_mcal_kg: 1.52, me: 2.60, tdn: 65.0,
    rdp_pct: 75.0, rup_pct: 25.0,
    ca: 0.14, p_total: 1.15, k: 1.40, mg: 0.55, s: 0.22,
    total_lys: 0.60, total_met: 0.23
  },

  "blood_meal_dairy": {
    display_name: "Blood Meal — Dairy",
    category: "animal_protein",
    ingredient_type: "blood_product",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 91.0, cp: 88.0, ee: 1.2, ash: 4.5,
    nel_mcal_kg: 2.11, tdn: 78.0,
    rdp_pct: 18.0, rup_pct: 82.0,
    total_lys: 7.50, total_met: 0.85, total_thr: 3.15, total_trp: 1.10,
    total_arg: 3.35, total_val: 5.50, total_ile: 0.55, total_leu: 10.0,
    total_his: 4.20, total_phe: 5.30
  },

  "rumen_protected_fat_dairy": {
    display_name: "Rumen Protected Fat (Bypass Fat) — Dairy",
    category: "fat_oil",
    ingredient_type: "rumen_bypass_fat",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 99.0, cp: 0, ee: 85.0,
    nel_mcal_kg: 4.60, me: 7.20, tdn: 190.0,
    ca: 9.0,
    notes: "Calcium salt of fatty acids. Typical inclusion 200-400g/head/day."
  },

  "sodium_bicarbonate_dairy": {
    display_name: "Sodium Bicarbonate (Buffer) — Dairy",
    category: "mineral",
    ingredient_type: "buffer",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 99.0, cp: 0, na: 27.0, cl: 0,
    nel_mcal_kg: 0, tdn: 0,
    notes: "Rumen buffer. Typical use 200g/head/day in high-grain dairy TMR."
  },

  "rumen_protected_lysine": {
    display_name: "Rumen Protected Lysine — Dairy",
    category: "amino_acid",
    ingredient_type: "rumen_bypass_aa",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 99.0, cp: 0,
    total_lys: 25.0,
    nel_mcal_kg: 0, tdn: 0,
    notes: "Bypass lysine. Bioavailability ~70%. Typical inclusion 10-30g/head/day."
  },

  "rumen_protected_methionine": {
    display_name: "Rumen Protected Methionine — Dairy",
    category: "amino_acid",
    ingredient_type: "rumen_bypass_aa",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 99.0, cp: 0,
    total_met: 85.0,
    nel_mcal_kg: 0, tdn: 0,
    notes: "Bypass methionine (Smartamine/Mepron equivalent). Typical 5-15g/head/day."
  },

  "sorghum_grain_dairy": {
    display_name: "Sorghum (Grain) — Dairy",
    category: "cereal_grain",
    ingredient_type: "grain",
    species_compatibility: ["dairy"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 89.0, cp: 9.7, ee: 3.1, cf: 2.8, ash: 1.8, ndf: 18.5, adf: 7.5,
    nel_mcal_kg: 1.90, me: 3.23, tdn: 82.0,
    rdp_pct: 60.0, rup_pct: 40.0,
    ca: 0.04, p_total: 0.32, na: 0.02, k: 0.38, mg: 0.18,
    total_lys: 0.22, total_met: 0.15
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BEEF CATTLE — NEm/NEg system (NRC 2000)
  // ═══════════════════════════════════════════════════════════════════════════

  "corn_grain_beef": {
    display_name: "Corn (Grain) — Beef",
    category: "cereal_grain",
    ingredient_type: "grain",
    species_compatibility: ["beef"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2000_Beef",
    dm_pct: 88.0, cp: 8.5, ee: 3.8, cf: 2.2, ash: 1.3, ndf: 11.5, adf: 3.5,
    nem_mcal_kg: 2.07, neg_mcal_kg: 1.42, me: 3.38, tdn: 88.0,
    ca: 0.03, p_total: 0.28, na: 0.02, k: 0.37, mg: 0.11,
    total_lys: 0.25, total_met: 0.17,
    zn_ppm: 18, fe_ppm: 30, mn_ppm: 5, cu_ppm: 2, se_ppm: 0.03
  },

  "sorghum_grain_beef": {
    display_name: "Sorghum (Grain) — Beef",
    category: "cereal_grain",
    ingredient_type: "grain",
    species_compatibility: ["beef"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2000_Beef",
    dm_pct: 89.0, cp: 9.7, ee: 3.1, cf: 2.8, ash: 1.8, ndf: 18.5, adf: 7.5,
    nem_mcal_kg: 1.95, neg_mcal_kg: 1.31, me: 3.23, tdn: 82.0,
    ca: 0.04, p_total: 0.32, na: 0.02, k: 0.38, mg: 0.18,
    total_lys: 0.22, total_met: 0.15,
    zn_ppm: 17, fe_ppm: 55, mn_ppm: 15, cu_ppm: 6
  },

  "soybean_meal_44_beef": {
    display_name: "Soybean Meal 44% CP — Beef",
    category: "protein_meal",
    ingredient_type: "oilseed_meal",
    species_compatibility: ["beef"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2000_Beef",
    dm_pct: 89.0, cp: 44.0, ee: 2.0, cf: 6.5, ash: 6.5, ndf: 14.0, adf: 9.5,
    nem_mcal_kg: 1.91, neg_mcal_kg: 1.26, me: 3.10, tdn: 82.0,
    ca: 0.30, p_total: 0.65, na: 0.03, k: 2.20, mg: 0.28,
    total_lys: 2.70, total_met: 0.60, total_thr: 1.72, total_trp: 0.62, total_arg: 3.20,
    zn_ppm: 45, fe_ppm: 120, mn_ppm: 28, cu_ppm: 15, se_ppm: 0.10
  },

  "alfalfa_hay_beef": {
    display_name: "Alfalfa Hay — Beef",
    category: "forage",
    ingredient_type: "hay",
    species_compatibility: ["beef"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2000_Beef",
    dm_pct: 89.0, cp: 18.0, ee: 2.5, cf: 28.0, ash: 9.5, ndf: 40.0, adf: 30.0,
    nem_mcal_kg: 1.29, neg_mcal_kg: 0.68, me: 2.30, tdn: 60.0, pendf_factor: 1.0,
    ca: 1.40, p_total: 0.23, na: 0.09, k: 2.60, mg: 0.30, s: 0.30,
    zn_ppm: 25, fe_ppm: 180, mn_ppm: 32, cu_ppm: 9
  },

  "grass_hay_beef": {
    display_name: "Grass Hay (Mixed) — Beef",
    category: "forage",
    ingredient_type: "hay",
    species_compatibility: ["beef"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2000_Beef",
    dm_pct: 89.0, cp: 10.0, ee: 2.2, cf: 32.0, ash: 7.0, ndf: 62.0, adf: 38.0,
    nem_mcal_kg: 1.10, neg_mcal_kg: 0.52, me: 2.00, tdn: 54.0, pendf_factor: 1.0,
    ca: 0.45, p_total: 0.22, na: 0.05, k: 1.80, mg: 0.22,
    zn_ppm: 20, fe_ppm: 200, mn_ppm: 55, cu_ppm: 7
  },

  "corn_silage_beef": {
    display_name: "Corn Silage — Beef",
    category: "forage",
    ingredient_type: "silage",
    species_compatibility: ["beef"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2000_Beef",
    dm_pct: 32.0, cp: 8.5, ee: 3.2, cf: 22.0, ash: 4.2, ndf: 45.0, adf: 28.0,
    nem_mcal_kg: 0.52, neg_mcal_kg: 0.31, me: 0.94, tdn: 70.0, pendf_factor: 0.48,
    ca: 0.24, p_total: 0.21, k: 1.10, mg: 0.16
  },

  "cottonseed_meal_beef": {
    display_name: "Cottonseed Meal — Beef",
    category: "protein_meal",
    ingredient_type: "oilseed_meal",
    species_compatibility: ["beef"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2000_Beef",
    dm_pct: 91.0, cp: 41.0, ee: 2.5, cf: 13.0, ash: 6.5, ndf: 28.0, adf: 19.0,
    nem_mcal_kg: 1.68, neg_mcal_kg: 1.06, me: 2.82, tdn: 72.0,
    ca: 0.20, p_total: 1.10, k: 1.50, mg: 0.55,
    total_lys: 1.60, total_met: 0.55, total_arg: 4.20
  },

  "distillers_grains_dried_beef": {
    display_name: "Distillers Grains, Dried (DDGS) — Beef",
    category: "byproduct",
    ingredient_type: "fermentation_byproduct",
    species_compatibility: ["beef"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2000_Beef",
    dm_pct: 89.0, cp: 28.0, ee: 10.5, cf: 8.5, ash: 5.5, ndf: 40.0, adf: 18.0,
    nem_mcal_kg: 1.97, neg_mcal_kg: 1.33, me: 3.42, tdn: 87.0,
    ca: 0.22, p_total: 0.83, na: 0.40, k: 1.05, mg: 0.32, s: 0.55,
    zn_ppm: 75, cu_ppm: 12
  },

  "urea_ruminant": {
    display_name: "Urea (NPN Source) — Ruminant",
    category: "nit_non_protein",
    ingredient_type: "urea",
    species_compatibility: ["beef", "dairy", "sheep", "goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2000_Beef",
    dm_pct: 99.0, cp: 281.0,
    nem_mcal_kg: 0, neg_mcal_kg: 0, tdn: 0,
    notes: "NPN source — 281% CP equivalent. Max 1% of DM in cattle, 0.5% in small ruminants. Toxicity risk if overfed."
  },

  "canola_meal_beef": {
    display_name: "Canola Meal — Beef",
    category: "protein_meal",
    ingredient_type: "oilseed_meal",
    species_compatibility: ["beef"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2000_Beef",
    dm_pct: 90.0, cp: 38.0, ee: 3.5, cf: 11.5, ash: 7.0, ndf: 28.0, adf: 19.0,
    nem_mcal_kg: 1.64, neg_mcal_kg: 1.02, me: 2.86, tdn: 73.0,
    ca: 0.67, p_total: 1.12, na: 0.12, k: 1.30, mg: 0.52, s: 0.68,
    total_lys: 2.10, total_met: 0.74, total_thr: 1.62, total_arg: 2.32
  },

  "wheat_bran_beef": {
    display_name: "Wheat Bran — Beef",
    category: "byproduct",
    ingredient_type: "milling_byproduct",
    species_compatibility: ["beef"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2000_Beef",
    dm_pct: 88.0, cp: 16.5, ee: 4.0, cf: 11.5, ash: 6.0, ndf: 46.0, adf: 13.0,
    nem_mcal_kg: 1.47, neg_mcal_kg: 0.87, me: 2.60, tdn: 65.0,
    ca: 0.14, p_total: 1.15, k: 1.40, mg: 0.55
  },

  "barley_grain_beef": {
    display_name: "Barley (Grain) — Beef",
    category: "cereal_grain",
    ingredient_type: "grain",
    species_compatibility: ["beef"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2000_Beef",
    dm_pct: 88.0, cp: 11.5, ee: 1.8, cf: 5.5, ash: 2.5, ndf: 18.0, adf: 7.5,
    nem_mcal_kg: 1.97, neg_mcal_kg: 1.33, me: 3.15, tdn: 83.0,
    ca: 0.05, p_total: 0.33, na: 0.03, k: 0.45, mg: 0.14,
    total_lys: 0.43, total_met: 0.19,
    zn_ppm: 22, fe_ppm: 80, mn_ppm: 14, cu_ppm: 5
  },

  "monensin_beef": {
    display_name: "Monensin Premix — Beef Feedlot",
    category: "additive",
    ingredient_type: "ionophore",
    species_compatibility: ["beef"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2000_Beef",
    dm_pct: 99.0, cp: 0,
    nem_mcal_kg: 0, tdn: 0,
    notes: "Ionophore feed additive. Improves feed efficiency 3-7%. Include at label rate only. Not for dairy."
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEEP — NRC 2007 Small Ruminants
  // ═══════════════════════════════════════════════════════════════════════════

  "corn_grain_sheep": {
    display_name: "Corn (Grain) — Sheep",
    category: "cereal_grain",
    ingredient_type: "grain",
    species_compatibility: ["sheep"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 88.0, cp: 8.5, ee: 3.8, cf: 2.2, ash: 1.3, ndf: 11.5, adf: 3.5,
    me_mcal_kg: 3.38, de_mcal_kg: 3.80, tdn: 88.0,
    ca: 0.03, p_total: 0.28, na: 0.02, k: 0.37, mg: 0.11, s: 0.11,
    total_lys: 0.25, total_met: 0.17,
    zn_ppm: 18, fe_ppm: 30, mn_ppm: 5, cu_ppm: 2, se_ppm: 0.03,
    notes: "Copper max 15ppm in total sheep diet — monitor Cu from all sources"
  },

  "soybean_meal_sheep": {
    display_name: "Soybean Meal — Sheep",
    category: "protein_meal",
    ingredient_type: "oilseed_meal",
    species_compatibility: ["sheep"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 89.0, cp: 44.0, ee: 2.0, cf: 6.5, ash: 6.5, ndf: 14.0, adf: 9.5,
    me_mcal_kg: 3.10, de_mcal_kg: 3.50, tdn: 82.0,
    ca: 0.30, p_total: 0.65, na: 0.03, k: 2.20, mg: 0.28,
    total_lys: 2.70, total_met: 0.60, total_thr: 1.72, total_trp: 0.62, total_arg: 3.20,
    zn_ppm: 45, fe_ppm: 120, mn_ppm: 28, cu_ppm: 15, se_ppm: 0.10
  },

  "alfalfa_hay_sheep": {
    display_name: "Alfalfa Hay — Sheep",
    category: "forage",
    ingredient_type: "hay",
    species_compatibility: ["sheep"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 89.0, cp: 18.0, ee: 2.5, cf: 28.0, ash: 9.5, ndf: 40.0, adf: 30.0,
    me_mcal_kg: 2.30, de_mcal_kg: 2.65, tdn: 60.0,
    ca: 1.40, p_total: 0.23, na: 0.09, k: 2.60, mg: 0.30, s: 0.30,
    zn_ppm: 25, fe_ppm: 180, mn_ppm: 32, cu_ppm: 9, se_ppm: 0.15
  },

  "grass_hay_sheep": {
    display_name: "Grass Hay — Sheep",
    category: "forage",
    ingredient_type: "hay",
    species_compatibility: ["sheep"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 89.0, cp: 10.0, ee: 2.2, cf: 32.0, ash: 7.0, ndf: 62.0, adf: 38.0,
    me_mcal_kg: 2.00, de_mcal_kg: 2.30, tdn: 54.0,
    ca: 0.45, p_total: 0.22, na: 0.05, k: 1.80, mg: 0.22,
    zn_ppm: 20, fe_ppm: 200, mn_ppm: 55, cu_ppm: 7
  },

  "barley_grain_sheep": {
    display_name: "Barley (Grain) — Sheep",
    category: "cereal_grain",
    ingredient_type: "grain",
    species_compatibility: ["sheep"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 88.0, cp: 11.5, ee: 1.8, cf: 5.5, ash: 2.5, ndf: 18.0, adf: 7.5,
    me_mcal_kg: 3.15, de_mcal_kg: 3.55, tdn: 83.0,
    ca: 0.05, p_total: 0.33, na: 0.03, k: 0.45, mg: 0.14,
    total_lys: 0.43, total_met: 0.19,
    zn_ppm: 22, fe_ppm: 80, mn_ppm: 14, cu_ppm: 5
  },

  "oats_grain_sheep": {
    display_name: "Oats (Grain) — Sheep",
    category: "cereal_grain",
    ingredient_type: "grain",
    species_compatibility: ["sheep"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 89.0, cp: 11.8, ee: 4.5, cf: 11.5, ash: 3.5, ndf: 28.0, adf: 14.0,
    me_mcal_kg: 2.98, de_mcal_kg: 3.36, tdn: 77.0,
    ca: 0.07, p_total: 0.33, na: 0.03, k: 0.44, mg: 0.13,
    total_lys: 0.40, total_met: 0.17,
    zn_ppm: 32, fe_ppm: 80, mn_ppm: 38, cu_ppm: 5
  },

  "sheep_mineral_premix": {
    display_name: "Sheep Mineral Premix (Low Cu)",
    category: "mineral",
    ingredient_type: "mineral_premix",
    species_compatibility: ["sheep"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 99.0, cp: 0,
    ca: 14.0, p_total: 7.0, na: 4.0, mg: 2.5, s: 0.5,
    zn_ppm: 2500, fe_ppm: 1000, mn_ppm: 600, cu_ppm: 250, se_ppm: 25,
    notes: "Low copper formulation — sheep are highly sensitive to copper toxicity. Max total dietary Cu: 15ppm DM."
  },

  "pasture_sheep": {
    display_name: "Pasture (Mixed Grass-Legume) — Sheep",
    category: "forage",
    ingredient_type: "pasture",
    species_compatibility: ["sheep"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 20.0, cp: 16.0, ee: 3.0, cf: 22.0, ash: 9.0, ndf: 42.0, adf: 28.0,
    me_mcal_kg: 0.50, de_mcal_kg: 0.57, tdn: 58.0,
    ca: 0.90, p_total: 0.30, k: 2.80, mg: 0.22,
    notes: "Highly variable. Values represent mid-season temperate mixed pasture."
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GOATS — NRC 2007 Small Ruminants
  // Higher Cu tolerance than sheep
  // ═══════════════════════════════════════════════════════════════════════════

  "corn_grain_goat": {
    display_name: "Corn (Grain) — Goat",
    category: "cereal_grain",
    ingredient_type: "grain",
    species_compatibility: ["goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 88.0, cp: 8.5, ee: 3.8, cf: 2.2, ash: 1.3, ndf: 11.5, adf: 3.5,
    me_mcal_kg: 3.38, de_mcal_kg: 3.80, tdn: 88.0,
    ca: 0.03, p_total: 0.28, na: 0.02, k: 0.37, mg: 0.11,
    total_lys: 0.25, total_met: 0.17,
    zn_ppm: 18, fe_ppm: 30, mn_ppm: 5, cu_ppm: 10, se_ppm: 0.03
  },

  "soybean_meal_goat": {
    display_name: "Soybean Meal — Goat",
    category: "protein_meal",
    ingredient_type: "oilseed_meal",
    species_compatibility: ["goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 89.0, cp: 44.0, ee: 2.0, cf: 6.5, ash: 6.5, ndf: 14.0, adf: 9.5,
    me_mcal_kg: 3.10, de_mcal_kg: 3.50, tdn: 82.0,
    ca: 0.30, p_total: 0.65, na: 0.03, k: 2.20, mg: 0.28,
    total_lys: 2.70, total_met: 0.60, total_thr: 1.72, total_trp: 0.62, total_arg: 3.20,
    zn_ppm: 45, fe_ppm: 120, mn_ppm: 28, cu_ppm: 20, se_ppm: 0.10
  },

  "alfalfa_hay_goat": {
    display_name: "Alfalfa Hay — Goat",
    category: "forage",
    ingredient_type: "hay",
    species_compatibility: ["goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 89.0, cp: 18.0, ee: 2.5, cf: 28.0, ash: 9.5, ndf: 40.0, adf: 30.0,
    me_mcal_kg: 2.30, de_mcal_kg: 2.65, tdn: 60.0,
    ca: 1.40, p_total: 0.23, na: 0.09, k: 2.60, mg: 0.30, s: 0.30,
    zn_ppm: 25, fe_ppm: 180, mn_ppm: 32, cu_ppm: 9
  },

  "grass_hay_goat": {
    display_name: "Grass Hay — Goat",
    category: "forage",
    ingredient_type: "hay",
    species_compatibility: ["goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 89.0, cp: 10.0, ee: 2.2, cf: 32.0, ash: 7.0, ndf: 62.0, adf: 38.0,
    me_mcal_kg: 2.00, de_mcal_kg: 2.30, tdn: 54.0,
    ca: 0.45, p_total: 0.22, na: 0.05, k: 1.80, mg: 0.22
  },

  "browse_goat": {
    display_name: "Browse / Shrub Mix — Goat",
    category: "forage",
    ingredient_type: "browse",
    species_compatibility: ["goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 45.0, cp: 14.0, ee: 3.5, cf: 25.0, ash: 7.0, ndf: 50.0, adf: 32.0,
    me_mcal_kg: 1.85, de_mcal_kg: 2.10, tdn: 52.0,
    ca: 1.20, p_total: 0.18, k: 2.10,
    notes: "Typical browse estimate for mixed shrub species. Highly variable by species and season."
  },

  "grain_mix_dairy_goat": {
    display_name: "Grain Mix — Dairy Goat",
    category: "cereal_grain",
    ingredient_type: "mixed_grain",
    species_compatibility: ["goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 88.0, cp: 16.0, ee: 3.5, cf: 5.5, ash: 5.5, ndf: 22.0, adf: 9.5,
    me_mcal_kg: 3.00, de_mcal_kg: 3.40, tdn: 78.0,
    ca: 0.85, p_total: 0.55, na: 0.28, k: 0.85, mg: 0.25,
    total_lys: 0.72, total_met: 0.24,
    zn_ppm: 80, cu_ppm: 20, se_ppm: 0.30
  },

  "goat_mineral_premix": {
    display_name: "Goat Mineral Premix",
    category: "mineral",
    ingredient_type: "mineral_premix",
    species_compatibility: ["goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 99.0, cp: 0,
    ca: 14.0, p_total: 7.0, na: 4.0, mg: 2.5,
    zn_ppm: 2500, fe_ppm: 1000, mn_ppm: 600, cu_ppm: 1500, se_ppm: 25,
    notes: "Higher copper than sheep premix — goats tolerate up to 80ppm Cu total diet."
  },

  "pasture_goat": {
    display_name: "Pasture (Mixed) — Goat",
    category: "forage",
    ingredient_type: "pasture",
    species_compatibility: ["goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2007_SmallRuminants",
    dm_pct: 20.0, cp: 15.0, ee: 3.0, cf: 23.0, ash: 9.0, ndf: 45.0, adf: 30.0,
    me_mcal_kg: 0.48, de_mcal_kg: 0.55, tdn: 56.0,
    ca: 0.85, p_total: 0.28, k: 2.60, mg: 0.20
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SHARED RUMINANT MINERALS & ADDITIVES
  // ═══════════════════════════════════════════════════════════════════════════

  "calcium_carbonate_ruminant": {
    display_name: "Calcium Carbonate (Limestone) — Ruminant",
    category: "mineral",
    ingredient_type: "calcium_source",
    species_compatibility: ["dairy", "beef", "sheep", "goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 99.0, cp: 0, ca: 38.0, p_total: 0.02,
    nel_mcal_kg: 0, me_mcal_kg: 0, tdn: 0
  },

  "dicalcium_phosphate_ruminant": {
    display_name: "Dicalcium Phosphate — Ruminant",
    category: "mineral",
    ingredient_type: "calcium_phosphorus_source",
    species_compatibility: ["dairy", "beef", "sheep", "goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 97.0, cp: 0, ca: 22.0, p_total: 18.5,
    nel_mcal_kg: 0, me_mcal_kg: 0, tdn: 0
  },

  "monocalcium_phosphate_ruminant": {
    display_name: "Monocalcium Phosphate — Ruminant",
    category: "mineral",
    ingredient_type: "phosphorus_source",
    species_compatibility: ["dairy", "beef", "sheep", "goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 97.0, cp: 0, ca: 16.0, p_total: 21.0,
    nel_mcal_kg: 0, me_mcal_kg: 0, tdn: 0
  },

  "sodium_chloride_ruminant": {
    display_name: "Salt (NaCl) — Ruminant",
    category: "mineral",
    ingredient_type: "sodium_source",
    species_compatibility: ["dairy", "beef", "sheep", "goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 99.0, cp: 0, na: 39.0, cl: 60.5,
    nel_mcal_kg: 0, me_mcal_kg: 0, tdn: 0
  },

  "magnesium_oxide_ruminant": {
    display_name: "Magnesium Oxide — Ruminant",
    category: "mineral",
    ingredient_type: "magnesium_source",
    species_compatibility: ["dairy", "beef", "sheep", "goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 99.0, cp: 0, mg: 54.0,
    nel_mcal_kg: 0, me_mcal_kg: 0, tdn: 0
  },

  "vitamin_ade_ruminant": {
    display_name: "Vitamin A+D+E Premix — Ruminant",
    category: "vitamin",
    ingredient_type: "vitamin_premix",
    species_compatibility: ["dairy", "beef", "sheep", "goat"],
    nutrient_basis: "as_fed",
    source_ref: "NRC_2001_Dairy",
    dm_pct: 99.0, cp: 0,
    nel_mcal_kg: 0, me_mcal_kg: 0, tdn: 0,
    notes: "Vit A 500,000 IU/kg + Vit D3 100,000 IU/kg + Vit E 5,000 IU/kg. Typical inclusion 5-10g/head/day."
  }
};

// ── Migration Runner ──────────────────────────────────────────────────────────
async function migrate() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  NutrixDB Ruminant Migration v1");
  console.log("  Adding: Dairy, Beef, Sheep, Goat ingredients");
  console.log("═══════════════════════════════════════════════════════\n");

  // Read existing DB
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ DB file not found: ${DB_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(DB_PATH, "utf8");
  const db = JSON.parse(raw);

  if (!db.db || typeof db.db !== "object") {
    console.error("❌ Invalid DB structure — expected { db: { ... } }");
    process.exit(1);
  }

  // Create backup
  const backupPath = DB_PATH.replace(".json", `.bak_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupPath, raw, "utf8");
  console.log(`✅ Backup created: ${backupPath.split("/").pop()}`);

  // Count existing
  const existingCount = Object.keys(db.db).length;
  console.log(`📦 Existing ingredients: ${existingCount}`);

  // Track results
  let added = 0;
  let skipped = 0;
  const addedKeys = [];
  const skippedKeys = [];

  for (const [key, ingredient] of Object.entries(RUMINANT_INGREDIENTS)) {
    if (db.db[key]) {
      skipped++;
      skippedKeys.push(key);
    } else {
      db.db[key] = ingredient;
      added++;
      addedKeys.push(key);
    }
  }

  // Write updated DB
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");

  const newCount = Object.keys(db.db).length;

  console.log(`\n✅ Added: ${added} new ingredients`);
  if (skipped > 0) console.log(`⚠️  Skipped (already exist): ${skipped}`);
  console.log(`📦 Total ingredients now: ${newCount}`);

  // Summary by species
  const speciesCount = {};
  for (const ing of Object.values(db.db)) {
    const compat = ing.species_compatibility || [];
    for (const sp of compat) {
      speciesCount[sp] = (speciesCount[sp] || 0) + 1;
    }
  }
  console.log("\n📊 Ingredients by species:");
  for (const [sp, count] of Object.entries(speciesCount).sort()) {
    console.log(`   ${sp.padEnd(12)} ${count}`);
  }

  console.log("\n✅ Added ingredients:");
  addedKeys.forEach(k => console.log(`   + ${k}`));

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Migration complete. Restart AgroCore server to reload.");
  console.log("═══════════════════════════════════════════════════════");
}

migrate().catch(err => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
