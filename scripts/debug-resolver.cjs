// scripts/debug-resolver.cjs
"use strict";

/**
 * Debug utility: verifies the *current* structured ingredients loader and basic alias resolution.
 *
 * Run:
 *   node scripts/debug-resolver.cjs
 */

const { loadIngredients } = require("../core/db/ingredients/_index/LOAD_INGREDIENTS.cjs");
const { resolveDbIngredientKey } = require("../core/aliases/resolveDbIngredientKey.cjs");

function main() {
  const r = loadIngredients({
    species: "poultry",
    region: "us",
    version: "v1",
    basis: "sid",
  });

  if (!r || !r.db) {
    console.error("❌ loadIngredients failed:", r);
    process.exit(1);
  }

  const db = r.db;

  console.log("✅ ingredients_mode =", r.mode || (r.source && r.source.mode) || "unknown");
  console.log("✅ ingredients_source =", r.source || null);
  console.log("✅ ingredient_count =", Object.keys(db).length);

  console.log("has corn =", !!db.corn);
  console.log("has soybean_meal_48 =", !!db.soybean_meal_48);
  console.log("has l_lys_hcl =", !!db.l_lys_hcl);

  // Alias resolver sanity checks (against structured DB)
  console.log("resolve soybean_meal ->", resolveDbIngredientKey("soybean_meal", db));
  console.log("resolve sbm ->", resolveDbIngredientKey("sbm", db));
  console.log("resolve limestone grit ->", resolveDbIngredientKey("limestone grit", db));
  console.log("resolve dl met ->", resolveDbIngredientKey("dl met", db));
}

main();