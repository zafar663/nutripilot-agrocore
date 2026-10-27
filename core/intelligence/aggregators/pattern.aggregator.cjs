"use strict";

/**
 * AgroCore Intelligence Engine (AIE)
 * core/intelligence/aggregators/pattern.aggregator.cjs
 * 
 * Level 2: Aggregates user behavior patterns into community insights.
 * Runs on-demand or scheduled (e.g. nightly).
 */

const { getDb } = require("../db/aie.schema.cjs");
const { randomUUID } = require("crypto");

/**
 * Rebuild community insights from all constraint adjustments.
 * Groups by species + production + nutrient_key + field
 * Calculates percentiles of user-set values.
 */
function rebuildCommunityInsights() {
  const db = getDb();

  const groups = db.prepare(`
    SELECT 
      species, production, nutrient_key, field,
      COUNT(*) as sample_count,
      to_value
    FROM user_constraint_adjustments
    WHERE to_value IS NOT NULL
    GROUP BY species, production, nutrient_key, field
    ORDER BY species, production, nutrient_key, field
  `).all();

  // Get all values per group for percentile calculation
  const groupMap = {};
  const allValues = db.prepare(`
    SELECT species, production, nutrient_key, field, to_value
    FROM user_constraint_adjustments
    WHERE to_value IS NOT NULL
    ORDER BY species, production, nutrient_key, field, to_value
  `).all();

  for (const row of allValues) {
    const key = `${row.species}|${row.production}|${row.nutrient_key}|${row.field}`;
    if (!groupMap[key]) groupMap[key] = [];
    groupMap[key].push(Number(row.to_value));
  }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO community_insights (
      id, species, production, nutrient_key, field,
      p10, p25, p50, p75, p90, sample_count, last_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const transaction = db.transaction(() => {
    for (const [key, values] of Object.entries(groupMap)) {
      const [species, production, nutrient_key, field] = key.split("|");
      values.sort((a, b) => a - b);
      const n = values.length;

      upsert.run(
        randomUUID(), species, production, nutrient_key, field,
        percentile(values, 10),
        percentile(values, 25),
        percentile(values, 50),
        percentile(values, 75),
        percentile(values, 90),
        n
      );
    }
  });

  transaction();
  return Object.keys(groupMap).length;
}

/**
 * Get community insights for a specific species + production
 * Returns what the community typically sets for each nutrient constraint
 */
function getCommunityInsights({ species, production }) {
  const db = getDb();
  return db.prepare(`
    SELECT nutrient_key, field, p25, p50, p75, sample_count
    FROM community_insights
    WHERE species = ? AND production = ?
    ORDER BY nutrient_key, field
  `).all(species, production);
}

/**
 * Get top ingredients used for a species + production
 */
function getTopIngredients({ species, production, limit = 10 }) {
  const db = getDb();
  return db.prepare(`
    SELECT 
      fi.ingredient_id,
      fi.ingredient_name,
      fi.category,
      COUNT(*) as usage_count,
      AVG(fi.inclusion_pct) as avg_inclusion,
      AVG(fe.cost_per_ton) as avg_formula_cost
    FROM formula_ingredients fi
    JOIN formula_events fe ON fi.event_id = fe.id
    WHERE fe.species = ? AND fe.production = ?
      AND fe.feasible = 1
      AND fi.inclusion_pct > 0
    GROUP BY fi.ingredient_id
    ORDER BY usage_count DESC
    LIMIT ?
  `).all(species, production, limit);
}

/**
 * Get scenario success rates
 */
function getScenarioStats({ species }) {
  const db = getDb();
  return db.prepare(`
    SELECT 
      scenario_id,
      COUNT(*) as usage_count,
      AVG(led_to_feasible) as feasibility_rate,
      AVG(cost_per_ton) as avg_cost
    FROM scenario_usage
    WHERE species = ?
    GROUP BY scenario_id
    ORDER BY usage_count DESC
  `).all(species);
}

/**
 * Get common constraint patterns — what MIN/MAX users typically set
 */
function getConstraintPatterns({ species, production }) {
  const db = getDb();
  
  const patterns = db.prepare(`
    SELECT 
      nutrient_key,
      field,
      COUNT(*) as adjustment_count,
      AVG(to_value) as avg_value,
      MIN(to_value) as min_value,
      MAX(to_value) as max_value
    FROM user_constraint_adjustments
    WHERE species = ? AND production = ?
    GROUP BY nutrient_key, field
    HAVING adjustment_count >= 3
    ORDER BY adjustment_count DESC
  `).all(species, production);

  return patterns;
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

module.exports = {
  rebuildCommunityInsights,
  getCommunityInsights,
  getTopIngredients,
  getScenarioStats,
  getConstraintPatterns
};
