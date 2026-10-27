"use strict";

/**
 * AgroCore Intelligence Engine (AIE)
 * core/intelligence/db/aie.schema.cjs
 * 
 * SQLite database schema for all 4 levels of learning:
 * Level 1: Expert rules (NRC) — referenced, not stored
 * Level 2: User feedback learning — formula events, adjustments
 * Level 3: Outcome learning — FarmPulse integration
 * Level 4: ML model metadata — model versions, predictions
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "../../../data/aie.db");
const DB_DIR = path.dirname(DB_PATH);

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let _db = null;

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`

    -- ═══════════════════════════════════════════════════════
    -- LEVEL 2: USER FEEDBACK LEARNING
    -- ═══════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS formula_events (
      id                  TEXT PRIMARY KEY,
      farm_id             TEXT,
      user_id             TEXT,
      timestamp           TEXT NOT NULL,
      species             TEXT NOT NULL,
      type                TEXT,
      production          TEXT,
      body_weight_kg      REAL,
      intake_pct_bw       REAL,
      work_level          TEXT,
      scenario_applied    TEXT,
      optimization_result TEXT,  -- 'feasible' | 'infeasible' | 'partial'
      optimization_mode   TEXT,  -- 'formulation' | 'reformulation'
      cost_per_ton        REAL,
      feasible            INTEGER DEFAULT 1,
      ingredient_count    INTEGER,
      formula_text        TEXT,
      created_at          TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS formula_ingredients (
      id               TEXT PRIMARY KEY,
      event_id         TEXT NOT NULL REFERENCES formula_events(id),
      ingredient_id    TEXT NOT NULL,
      ingredient_name  TEXT,
      inclusion_pct    REAL,
      cost_per_ton     REAL,
      cost_contribution REAL,
      category         TEXT
    );

    CREATE TABLE IF NOT EXISTS formula_nutrients (
      id           TEXT PRIMARY KEY,
      event_id     TEXT NOT NULL REFERENCES formula_events(id),
      nutrient_key TEXT NOT NULL,
      actual_value REAL,
      target_value REAL,
      min_value    REAL,
      max_value    REAL,
      status       TEXT  -- 'OK' | 'FAIL' | 'HIGH' | 'WARN'
    );

    CREATE TABLE IF NOT EXISTS user_constraint_adjustments (
      id           TEXT PRIMARY KEY,
      event_id     TEXT NOT NULL REFERENCES formula_events(id),
      farm_id      TEXT,
      user_id      TEXT,
      species      TEXT,
      production   TEXT,
      nutrient_key TEXT NOT NULL,
      field        TEXT NOT NULL,  -- 'min' | 'max' | 'target'
      from_value   REAL,
      to_value     REAL,
      timestamp    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scenario_usage (
      id           TEXT PRIMARY KEY,
      farm_id      TEXT,
      user_id      TEXT,
      species      TEXT NOT NULL,
      production   TEXT NOT NULL,
      scenario_id  TEXT NOT NULL,
      applied_at   TEXT NOT NULL,
      led_to_feasible INTEGER,
      cost_per_ton REAL
    );

    -- ═══════════════════════════════════════════════════════
    -- LEVEL 3: OUTCOME LEARNING (FarmPulse Integration)
    -- ═══════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS farm_batches (
      id              TEXT PRIMARY KEY,
      farm_id         TEXT NOT NULL,
      species         TEXT NOT NULL,
      production      TEXT,
      batch_name      TEXT,
      start_date      TEXT,
      end_date        TEXT,
      animal_count    INTEGER,
      start_weight_kg REAL,
      end_weight_kg   REAL,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS batch_formulas (
      id           TEXT PRIMARY KEY,
      batch_id     TEXT NOT NULL REFERENCES farm_batches(id),
      event_id     TEXT REFERENCES formula_events(id),
      applied_from TEXT NOT NULL,
      applied_to   TEXT,
      feed_kg_total REAL
    );

    CREATE TABLE IF NOT EXISTS batch_outcomes (
      id                TEXT PRIMARY KEY,
      batch_id          TEXT NOT NULL REFERENCES farm_batches(id),
      farm_id           TEXT,
      species           TEXT,
      production        TEXT,
      days              INTEGER,
      fcr               REAL,  -- feed conversion ratio
      mortality_pct     REAL,
      avg_daily_gain_kg REAL,
      milk_yield_l_day  REAL,  -- dairy
      egg_production_pct REAL, -- poultry
      health_score      REAL,  -- 0-100
      economic_return   REAL,  -- profit per animal
      recorded_at       TEXT DEFAULT (datetime('now')),
      notes             TEXT
    );

    CREATE TABLE IF NOT EXISTS nutrient_outcome_correlations (
      id              TEXT PRIMARY KEY,
      species         TEXT NOT NULL,
      production      TEXT NOT NULL,
      nutrient_key    TEXT NOT NULL,
      nutrient_range_min REAL,
      nutrient_range_max REAL,
      avg_fcr         REAL,
      avg_daily_gain  REAL,
      avg_health_score REAL,
      sample_count    INTEGER,
      confidence      REAL,  -- 0-1
      last_updated    TEXT DEFAULT (datetime('now'))
    );

    -- ═══════════════════════════════════════════════════════
    -- LEVEL 4: ML MODEL METADATA
    -- ═══════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS ml_models (
      id            TEXT PRIMARY KEY,
      model_type    TEXT NOT NULL,  -- 'scenario_recommender' | 'outcome_predictor' | 'constraint_optimizer'
      species       TEXT,
      production    TEXT,
      version       TEXT NOT NULL,
      trained_at    TEXT,
      sample_count  INTEGER,
      accuracy      REAL,
      features      TEXT,  -- JSON array of feature names
      model_path    TEXT,  -- path to serialized model
      active        INTEGER DEFAULT 0,
      notes         TEXT
    );

    CREATE TABLE IF NOT EXISTS ml_predictions (
      id              TEXT PRIMARY KEY,
      model_id        TEXT REFERENCES ml_models(id),
      event_id        TEXT REFERENCES formula_events(id),
      prediction_type TEXT NOT NULL,
      input_features  TEXT,  -- JSON
      prediction      TEXT,  -- JSON
      confidence      REAL,
      actual_outcome  TEXT,  -- JSON, filled later
      predicted_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scenario_recommendations (
      id              TEXT PRIMARY KEY,
      farm_id         TEXT,
      species         TEXT NOT NULL,
      production      TEXT NOT NULL,
      body_weight_kg  REAL,
      recommended_constraints TEXT,  -- JSON {key: {min, max, target}}
      source          TEXT,  -- 'nrc' | 'community' | 'ml'
      confidence      REAL,
      sample_basis    INTEGER,  -- how many formulas this is based on
      generated_at    TEXT DEFAULT (datetime('now'))
    );

    -- ═══════════════════════════════════════════════════════
    -- COMMUNITY INSIGHTS (aggregated, anonymous)
    -- ═══════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS community_insights (
      id              TEXT PRIMARY KEY,
      species         TEXT NOT NULL,
      production      TEXT NOT NULL,
      nutrient_key    TEXT NOT NULL,
      field           TEXT NOT NULL,  -- 'min' | 'max' | 'target'
      p10             REAL,  -- 10th percentile of user values
      p25             REAL,
      p50             REAL,  -- median
      p75             REAL,
      p90             REAL,
      sample_count    INTEGER,
      last_updated    TEXT DEFAULT (datetime('now'))
    );

    -- ═══════════════════════════════════════════════════════
    -- Q&A EVENTS (WhatsApp + Discora questions)
    -- ═══════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS qa_events (
      id          TEXT PRIMARY KEY,
      source      TEXT NOT NULL,  -- 'whatsapp' | 'discora' | 'web'
      user_id     TEXT,
      question    TEXT NOT NULL,
      answer      TEXT,
      query_type  TEXT,           -- 'breed_standards' | 'nutrient_req' | 'mill_ops' | 'formula' | 'general'
      species     TEXT,
      breed       TEXT,
      phase       TEXT,
      nutrient    TEXT,
      resolved    INTEGER DEFAULT 1,  -- 1 = answered, 0 = fallback/error
      latency_ms  INTEGER,
      asked_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_qa_source   ON qa_events(source);
    CREATE INDEX IF NOT EXISTS idx_qa_type     ON qa_events(query_type);
    CREATE INDEX IF NOT EXISTS idx_qa_species  ON qa_events(species);
    CREATE INDEX IF NOT EXISTS idx_qa_asked_at ON qa_events(asked_at);

    -- ═══════════════════════════════════════════════════════
    -- CROSS-MODULE ACTIVITY (Nutrix users + Discora community)
    -- ═══════════════════════════════════════════════════════

    CREATE TABLE IF NOT EXISTS activity_events (
      id          TEXT PRIMARY KEY,
      source      TEXT NOT NULL,
      kind        TEXT NOT NULL,
      user_id     TEXT,
      mill_id     TEXT,
      species     TEXT,
      title       TEXT,
      body        TEXT,
      metadata    TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_source ON activity_events(source, kind);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at);

    -- ═══════════════════════════════════════════════════════
    -- INDEXES
    -- ═══════════════════════════════════════════════════════

    CREATE INDEX IF NOT EXISTS idx_events_species ON formula_events(species, production);
    CREATE INDEX IF NOT EXISTS idx_events_farm ON formula_events(farm_id);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON formula_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_nutrients_event ON formula_nutrients(event_id);
    CREATE INDEX IF NOT EXISTS idx_adjustments_species ON user_constraint_adjustments(species, production, nutrient_key);
    CREATE INDEX IF NOT EXISTS idx_outcomes_batch ON batch_outcomes(batch_id);
    CREATE INDEX IF NOT EXISTS idx_correlations_species ON nutrient_outcome_correlations(species, production, nutrient_key);

  `);
}

module.exports = { getDb };
