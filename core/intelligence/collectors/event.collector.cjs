"use strict";

/**
 * AgroCore Intelligence Engine (AIE)
 * core/intelligence/collectors/event.collector.cjs
 * 
 * Logs all formula events to the AIE database.
 * Called from analyze.route.js and optimize.route.js
 */

const { getDb } = require("../db/aie.schema.cjs");
const { randomUUID } = require("crypto");

/**
 * Log a formula analysis event
 */
function logFormulaEvent({
  farm_id = null,
  user_id = null,
  species,
  type,
  production,
  body_weight_kg,
  intake_pct_bw,
  work_level,
  scenario_applied = null,
  optimization_result = null,
  optimization_mode = null,
  cost_per_ton = null,
  feasible = true,
  formula_rows = [],
  nutrient_profile = {},
  nutrient_targets = {},
  formula_text = null
}) {
  try {
    const db = getDb();
    const event_id = randomUUID();
    const timestamp = new Date().toISOString();

    // Insert main event
    db.prepare(`
      INSERT INTO formula_events (
        id, farm_id, user_id, timestamp, species, type, production,
        body_weight_kg, intake_pct_bw, work_level, scenario_applied,
        optimization_result, optimization_mode, cost_per_ton, feasible,
        ingredient_count, formula_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event_id, farm_id, user_id, timestamp, species, type, production,
      body_weight_kg, intake_pct_bw, work_level, scenario_applied,
      optimization_result, optimization_mode, cost_per_ton,
      feasible ? 1 : 0, formula_rows.length, formula_text
    );

    // Insert ingredients
    const insertIngredient = db.prepare(`
      INSERT INTO formula_ingredients (
        id, event_id, ingredient_id, ingredient_name, 
        inclusion_pct, cost_per_ton, category
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of formula_rows) {
      insertIngredient.run(
        randomUUID(), event_id,
        row.ingredient_id || row.id || null,
        row.ingredient_name || row.display_name || null,
        Number(row.inclusion || row.optimized_inclusion || 0),
        Number(row.cost || row.price || 0),
        row.category || null
      );
    }

    // Insert nutrient profile
    const insertNutrient = db.prepare(`
      INSERT INTO formula_nutrients (
        id, event_id, nutrient_key, actual_value,
        target_value, min_value, max_value, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [key, actual] of Object.entries(nutrient_profile)) {
      if (actual == null) continue;
      const target = nutrient_targets[key];
      insertNutrient.run(
        randomUUID(), event_id, key,
        Number(actual),
        target?.target != null ? Number(target.target) : null,
        target?.min != null ? Number(target.min) : null,
        target?.max != null ? Number(target.max) : null,
        null
      );
    }

    return event_id;
  } catch (err) {
    console.error("[AIE] logFormulaEvent error:", err.message);
    return null;
  }
}

/**
 * Log a user constraint adjustment
 */
function logConstraintAdjustment({
  event_id = null,
  farm_id = null,
  user_id = null,
  species,
  production,
  nutrient_key,
  field,
  from_value,
  to_value
}) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO user_constraint_adjustments (
        id, event_id, farm_id, user_id, species, production,
        nutrient_key, field, from_value, to_value, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), event_id, farm_id, user_id, species, production,
      nutrient_key, field, from_value, to_value,
      new Date().toISOString()
    );
  } catch (err) {
    console.error("[AIE] logConstraintAdjustment error:", err.message);
  }
}

/**
 * Log scenario usage
 */
function logScenarioUsage({
  farm_id = null,
  user_id = null,
  species,
  production,
  scenario_id,
  led_to_feasible = null,
  cost_per_ton = null
}) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO scenario_usage (
        id, farm_id, user_id, species, production,
        scenario_id, applied_at, led_to_feasible, cost_per_ton
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), farm_id, user_id, species, production,
      scenario_id, new Date().toISOString(),
      led_to_feasible != null ? (led_to_feasible ? 1 : 0) : null,
      cost_per_ton
    );
  } catch (err) {
    console.error("[AIE] logScenarioUsage error:", err.message);
  }
}

/**
 * Log farm batch outcome (FarmPulse integration)
 */
function logBatchOutcome({
  batch_id,
  farm_id,
  species,
  production,
  days,
  fcr,
  mortality_pct,
  avg_daily_gain_kg,
  milk_yield_l_day = null,
  egg_production_pct = null,
  health_score = null,
  economic_return = null,
  notes = null
}) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO batch_outcomes (
        id, batch_id, farm_id, species, production, days,
        fcr, mortality_pct, avg_daily_gain_kg, milk_yield_l_day,
        egg_production_pct, health_score, economic_return, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), batch_id, farm_id, species, production, days,
      fcr, mortality_pct, avg_daily_gain_kg, milk_yield_l_day,
      egg_production_pct, health_score, economic_return, notes
    );
  } catch (err) {
    console.error("[AIE] logBatchOutcome error:", err.message);
  }
}

/**
 * Log a Q&A question event (WhatsApp / Discora / web)
 */
function logQAEvent({
  source = 'whatsapp',
  user_id = null,
  question,
  answer = null,
  query_type = null,
  species = null,
  breed = null,
  phase = null,
  nutrient = null,
  resolved = true,
  latency_ms = null,
}) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO qa_events (
        id, source, user_id, question, answer,
        query_type, species, breed, phase, nutrient,
        resolved, latency_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), source, user_id, question, answer,
      query_type, species, breed, phase, nutrient,
      resolved ? 1 : 0, latency_ms
    );
  } catch (err) {
    console.error('[AIE] logQAEvent error:', err.message);
  }
}

module.exports = {
  logFormulaEvent,
  logConstraintAdjustment,
  logScenarioUsage,
  logBatchOutcome,
  logQAEvent,
};
