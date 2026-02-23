// core/calc/CORE_CALC_NUTRIENTS.cjs
"use strict";

/**
 * calcNutrients(items, ingredientsDB, opts?)
 *
 * Backward compatible:
 * - If opts is missing, uses the original CORE keys:
 *   ["me","cp","lys","met","thr","ca","avp","na"]
 *
 * Enhanced:
 * - If opts.keys is provided (array), computes exactly those keys.
 * - Properly handles null/undefined nutrient values (treated as missing, NOT 0).
 * - Returns:
 *   {
 *     ...nutrients,
 *     unknown: [...],
 *     coverage: {
 *       <key>: { present: n, missing: n, nonzero: n, supported: true/false }
 *     }
 *   }
 *
 * Key rule (IMPORTANT):
 * - supported = true if at least one ingredient has a PRESENT value for that key
 *   (i.e., not null/undefined). Zero is a valid numeric value and still counts as "present".
 * - This prevents nutrients from being skipped just because their computed sum is 0.
 *
 * ADDITION:
 * - calcNutrientsRegistryDriven({ parsedItems, ingredientsDb, registry })
 *   Produces a registry-shaped profile (keyed by nutrient key) with id/unit/display_name included,
 *   plus coverage + missing_by_key diagnostics.
 */

function calcNutrients(items, ingredientsDB, opts = {}) {
  const defaultKeys = ["me", "cp", "lys", "met", "thr", "ca", "avp", "na"];

  const keys = Array.isArray(opts.keys) && opts.keys.length ? opts.keys : defaultKeys;

  const out = {};
  for (const k of keys) out[k] = 0;

  const unknown = [];

  // Coverage tracker per nutrient
  const coverage = {};
  for (const k of keys) {
    coverage[k] = {
      present: 0,   // value existed and was numeric (including 0)
      missing: 0,   // null/undefined/empty/non-numeric
      nonzero: 0,   // numeric and != 0 (debug)
      supported: false
    };
  }

  for (const it of items || []) {
    const ingredientName = it?.ingredient;
    const inclusion = Number(it?.inclusion ?? 0);

    if (!ingredientName || !Number.isFinite(inclusion)) continue;

    // Direct lookup (aliasing/normalization should happen upstream)
    const ing = ingredientsDB ? ingredientsDB[ingredientName] : null;

    if (!ing) {
      unknown.push({
        ingredient: ingredientName,
        dbKey: ingredientName,
        has_dbKey: Boolean(
          ingredientsDB &&
          Object.prototype.hasOwnProperty.call(ingredientsDB, ingredientName)
        ),
        inclusion
      });
      continue;
    }

    for (const k of keys) {
      const raw = ing[k];

      // Missing if null/undefined/empty string
      if (raw === null || raw === undefined || raw === "") {
        coverage[k].missing += 1;
        continue;
      }

      const v = Number(raw);
      if (!Number.isFinite(v)) {
        coverage[k].missing += 1;
        continue;
      }

      coverage[k].present += 1;
      if (v !== 0) coverage[k].nonzero += 1;

      out[k] += (inclusion * v) / 100;
    }
  }

  // supported logic: PRESENT (not null/undefined), not NONZERO
  for (const k of keys) {
    coverage[k].supported = coverage[k].present > 0;
  }

  // Stable rounding
  for (const k of keys) out[k] = Number(out[k].toFixed(4));

  out.unknown = unknown;
  out.coverage = coverage;
  return out;
}

/**
 * Registry-driven nutrient calculation
 * - Iterates registry nutrients by `key`
 * - Sums only over ingredients present in DB
 * - Skips missing nutrient values (does NOT treat missing as zero)
 * - Returns profile + coverage diagnostics
 *
 * Assumptions:
 * - parsedItems: [{ ingredient: "corn", inclusion: 60, ... }]
 * - ingredientsDb: { corn: { me: 3350, cp: 8.5, ... }, ... }
 * - registry: { nutrients: [{ key:"me", id:"energy.me_kcal_kg", unit_canonical:"kcal/kg", ... }, ...] }
 */
function calcNutrientsRegistryDriven({ parsedItems, ingredientsDb, registry }) {
  const nutrients = Array.isArray(registry?.nutrients) ? registry.nutrients : [];
  const keys = nutrients.map((n) => n && n.key).filter(Boolean);

  const nutrient_profile_full = {};
  const coverage_by_key = {};
  const missing_by_key = {}; // { key: [ingredientName,...] }

  // init
  for (const n of nutrients) {
    if (!n || !n.key) continue;

    nutrient_profile_full[n.key] = {
      key: n.key,
      id: n.id || null,
      display_name: n.display_name || n.key,
      unit: n.unit_canonical || null,
      value: null,        // null unless at least one contributor
      contributors: 0
    };

    coverage_by_key[n.key] = { have: 0, total: 0 };
    missing_by_key[n.key] = [];
  }

  // sum
  for (const item of parsedItems || []) {
    const ingKey = item?.ingredient;
    const inc = Number(item?.inclusion ?? 0);
    if (!ingKey || !Number.isFinite(inc) || inc <= 0) continue;

    const ing = ingredientsDb ? ingredientsDb[ingKey] : null;
    if (!ing) continue; // unknown handled elsewhere

    const frac = inc / 100.0;

    for (const k of keys) {
      coverage_by_key[k].total += 1;

      const raw = ing[k];
      if (raw === null || raw === undefined || raw === "") {
        missing_by_key[k].push(ingKey);
        continue;
      }

      const v = Number(raw);
      if (!Number.isFinite(v)) {
        missing_by_key[k].push(ingKey);
        continue;
      }

      const slot = nutrient_profile_full[k];
      if (slot.value === null) slot.value = 0;
      slot.value += frac * v;
      slot.contributors += 1;

      coverage_by_key[k].have += 1;
    }
  }

  // finalize rounding
  for (const k of keys) {
    const slot = nutrient_profile_full[k];
    if (slot && slot.value !== null) {
      slot.value = Math.round(slot.value * 100000) / 100000;
    }
  }

  return { nutrient_profile_full, coverage_by_key, missing_by_key };
}

module.exports = { calcNutrients, calcNutrientsRegistryDriven };