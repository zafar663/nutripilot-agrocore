"use strict";

/**
 * Nutrix Species Profile Router v1
 * Purpose:
 * Select species-specific nutrition system:
 * - nutrient registry
 * - ingredient database family
 * - requirements engine/profile system
 * - optimizer policy
 */

function normalizeSpecies(s) {
  return String(s || "").trim().toLowerCase();
}

const SPECIES_PROFILES = {
  poultry: {
    species: "poultry",
    nutrient_registry: "core/schema/master_nutrient_registry.v1.json",
    ingredient_db_root: "core/db/ingredients/poultry",
    requirements_root: "core/db/requirements/poultry",
    requirements_mode: "option_b",
    requirements_engine: "static_option_b_library",
    optimizer_policy: "core/db/optimizer_policies/poultry/poultry_optimizer_policy.v1.json",
    energy_system: "ME",
    amino_acid_system: "SID"
  },

  equine: {
    species: "equine",
    nutrient_registry: "core/schema/species/equine.nutrient_registry.v1.json",
    ingredient_db_root: "core/db/ingredients/equine",
    requirements_root: "core/db/requirements/equine",
    requirements_mode: "dynamic_nrc2007",
    requirements_engine: "equine_nrc2007",
    optimizer_policy: "core/db/optimizer_policies/equine/equine_optimizer_policy.v1.json",
    energy_system: "DE",
    amino_acid_system: "TOTAL"
  }
};

SPECIES_PROFILES.aqua = {
  species: "aqua",
  nutrient_registry: "core/schema/master_nutrient_registry.v1.json",
  ingredient_db_root: "core/db/ingredients/nutrixdb/v1",
  requirements_root: "core/db/requirements/aqua",
  requirements_mode: "aqua_nrc2011",
  requirements_engine: "aqua_nrc2011",
  optimizer_policy: "core/db/optimizer_policies/poultry/poultry_optimizer_policy.v1.json",
  energy_system: "DE",
  amino_acid_system: "TOTAL"
};

SPECIES_PROFILES.dog = {
  species: "dog",
  nutrient_registry: "core/schema/master_nutrient_registry.v1.json",
  ingredient_db_root: "core/db/ingredients/nutrixdb/v1",
  requirements_root: "core/db/requirements/dog",
  requirements_mode: "aafco_2024",
  requirements_engine: "dogEngine",
  optimizer_policy: "core/db/optimizer_policies/poultry/poultry_optimizer_policy.v1.json",
  energy_system: "ME",
  amino_acid_system: "TOTAL"
};
SPECIES_PROFILES.cat = {
  species: "cat",
  nutrient_registry: "core/schema/master_nutrient_registry.v1.json",
  ingredient_db_root: "core/db/ingredients/nutrixdb/v1",
  requirements_root: "core/db/requirements/cat",
  requirements_mode: "aafco_2024",
  requirements_engine: "catEngine",
  optimizer_policy: "core/db/optimizer_policies/poultry/poultry_optimizer_policy.v1.json",
  energy_system: "ME",
  amino_acid_system: "TOTAL"
};

SPECIES_PROFILES.rabbit = {
  species: "rabbit",
  nutrient_registry: "core/schema/master_nutrient_registry.v1.json",
  ingredient_db_root: "core/db/ingredients/nutrixdb/v1",
  requirements_root: "core/db/requirements/rabbit",
  requirements_mode: "rabbit_nrc1977",
  requirements_engine: "rabbitEngine",
  optimizer_policy: "core/db/optimizer_policies/poultry/poultry_optimizer_policy.v1.json",
  energy_system: "DE",
  amino_acid_system: "TOTAL"
};

SPECIES_PROFILES.aquaculture = SPECIES_PROFILES.aqua;

function getSpeciesProfile(species) {
  const key = normalizeSpecies(species);
  return SPECIES_PROFILES[key] || SPECIES_PROFILES.poultry;
}

// NP_SWINE_PROFILE_V1
SPECIES_PROFILES.swine = {
  species: "swine",
  nutrient_registry: "core/schema/master_nutrient_registry.v1.json",
  ingredient_db_root: "core/db/ingredients/swine",
  requirements_root: "core/db/requirements/swine",
  requirements_mode: "swine_v1",
  requirements_engine: "swine_pic2021",
  optimizer_policy: "core/db/optimizer_policies/poultry/poultry_optimizer_policy.v1.json",
  energy_system: "NE",
  amino_acid_system: "SID"
};

module.exports = {
  SPECIES_PROFILES,
  getSpeciesProfile
};

// Ruminant species � added NutrixDB ruminant migration v1
SPECIES_PROFILES.dairy = {
  species: "dairy",
  nutrient_registry: "core/schema/master_nutrient_registry.v1.json",
  ingredient_db_root: "core/db/ingredients/nutrixdb/v1",
  requirements_root: "core/db/requirements/dairy",
  requirements_mode: "dairy_nrc2001",
  requirements_engine: "dairy_nrc2001",
  optimizer_policy: "core/db/optimizer_policies/poultry/poultry_optimizer_policy.v1.json",
  energy_system: "NEL",
  amino_acid_system: "MP"
};

SPECIES_PROFILES.beef = {
  species: "beef",
  nutrient_registry: "core/schema/master_nutrient_registry.v1.json",
  ingredient_db_root: "core/db/ingredients/nutrixdb/v1",
  requirements_root: "core/db/requirements/beef",
  requirements_mode: "beef_nrc2000",
  requirements_engine: "beef_nrc2000",
  optimizer_policy: "core/db/optimizer_policies/poultry/poultry_optimizer_policy.v1.json",
  energy_system: "NEm_NEg",
  amino_acid_system: "TOTAL"
};

SPECIES_PROFILES.sheep = {
  species: "sheep",
  nutrient_registry: "core/schema/master_nutrient_registry.v1.json",
  ingredient_db_root: "core/db/ingredients/nutrixdb/v1",
  requirements_root: "core/db/requirements/sheep",
  requirements_mode: "sheep_nrc2007",
  requirements_engine: "sheep_nrc2007",
  optimizer_policy: "core/db/optimizer_policies/poultry/poultry_optimizer_policy.v1.json",
  energy_system: "ME",
  amino_acid_system: "TOTAL"
};

SPECIES_PROFILES.goat = {
  species: "goat",
  nutrient_registry: "core/schema/master_nutrient_registry.v1.json",
  ingredient_db_root: "core/db/ingredients/nutrixdb/v1",
  requirements_root: "core/db/requirements/goat",
  requirements_mode: "goat_nrc2007",
  requirements_engine: "goat_nrc2007",
  optimizer_policy: "core/db/optimizer_policies/poultry/poultry_optimizer_policy.v1.json",
  energy_system: "ME",
  amino_acid_system: "TOTAL"
};
