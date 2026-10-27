-- ─── FarmPulse SQLite Schema ──────────────────────────────────────────────────
-- DB file: nutripilot-agrocore/data/farmpulse.db
-- Mirrors: farm-pulse.models.ts types exactly
-- ─────────────────────────────────────────────────────────────────────────────

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Farms
CREATE TABLE IF NOT EXISTS farms (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  location      TEXT,
  species       TEXT NOT NULL CHECK(species IN ('poultry','swine','dairy')),
  contact_name  TEXT,
  contact_phone TEXT,
  capacity      INTEGER,
  status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Flocks
CREATE TABLE IF NOT EXISTS flocks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id           INTEGER NOT NULL REFERENCES farms(id),
  flock_code        TEXT NOT NULL,
  breed             TEXT,
  production_type   TEXT NOT NULL CHECK(production_type IN ('broiler','layer','breeder','pullet')),
  initial_count     INTEGER NOT NULL,
  placement_date    TEXT NOT NULL,
  expected_end_date TEXT,
  actual_end_date   TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','transferred')),
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Houses
CREATE TABLE IF NOT EXISTS houses (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id          INTEGER NOT NULL REFERENCES farms(id),
  flock_id         INTEGER REFERENCES flocks(id),
  house_name       TEXT NOT NULL,
  capacity         INTEGER,
  area_m2          REAL,
  ventilation_type TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Feed batches
CREATE TABLE IF NOT EXISTS feed_batches (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id          INTEGER NOT NULL REFERENCES farms(id),
  batch_code       TEXT NOT NULL,
  formula_id       INTEGER,
  formula_version  TEXT,
  feed_phase       TEXT CHECK(feed_phase IN ('starter','grower','finisher','layer')),
  quantity_kg      REAL NOT NULL,
  manufacture_date TEXT,
  delivery_date    TEXT NOT NULL,
  expiry_date      TEXT,
  supplier         TEXT,
  mill_batch_ref   TEXT,
  pellet_quality   TEXT CHECK(pellet_quality IN ('good','fines_high','poor')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','depleted','rejected')),
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily records
CREATE TABLE IF NOT EXISTS daily_records (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  flock_id              INTEGER NOT NULL REFERENCES flocks(id),
  house_id              INTEGER NOT NULL REFERENCES houses(id),
  feed_batch_id         INTEGER REFERENCES feed_batches(id),
  record_date           TEXT NOT NULL,
  bird_count            INTEGER NOT NULL,
  age_days              INTEGER,
  feed_intake_kg        REAL,
  feed_intake_per_bird_g REAL,
  water_intake_l        REAL,
  water_feed_ratio      REAL,
  avg_body_weight_g     REAL,
  target_body_weight_g  REAL,
  egg_count             INTEGER,
  egg_production_pct    REAL,
  avg_egg_weight_g      REAL,
  egg_mass_g            REAL,
  mortality_count       INTEGER NOT NULL DEFAULT 0,
  cull_count            INTEGER NOT NULL DEFAULT 0,
  cumulative_mortality  INTEGER,
  temperature_c         REAL,
  humidity_pct          REAL,
  light_hours           REAL,
  fcr                   REAL,
  adg_g                 REAL,
  mortality_rate_pct    REAL,
  epi                   REAL,
  -- Breed standard deviation fields (filled by perf-analyze engine)
  std_body_wt_g         REAL,
  std_fcr               REAL,
  std_adg_g             REAL,
  std_mortality_pct     REAL,
  dev_body_wt_pct       REAL,
  dev_fcr_pct           REAL,
  dev_adg_pct           REAL,
  dev_mortality_pct     REAL,
  perf_status           TEXT,
  -- Alert flags
  alert_feed_drop       INTEGER NOT NULL DEFAULT 0,
  alert_mortality_spike INTEGER NOT NULL DEFAULT 0,
  alert_water_spike     INTEGER NOT NULL DEFAULT 0,
  alert_fcr_drift       INTEGER NOT NULL DEFAULT 0,
  alert_std_deviation   INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_flock_house_date
  ON daily_records(flock_id, house_id, record_date);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  flock_id        INTEGER NOT NULL REFERENCES flocks(id),
  house_id        INTEGER REFERENCES houses(id),
  alert_date      TEXT NOT NULL,
  alert_type      TEXT NOT NULL CHECK(alert_type IN (
                    'feed_drop','mortality_spike','water_spike','fcr_drift',
                    'production_drop','std_deviation')),
  severity        TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
  message         TEXT NOT NULL,
  metric_value    REAL,
  threshold_value REAL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
  resolved_at     TEXT,
  resolved_by     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Health events
CREATE TABLE IF NOT EXISTS health_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  flock_id        INTEGER NOT NULL REFERENCES flocks(id),
  house_id        INTEGER REFERENCES houses(id),
  event_date      TEXT NOT NULL,
  event_type      TEXT NOT NULL CHECK(event_type IN ('vaccination','disease','medication','necropsy','treatment')),
  description     TEXT,
  pathogen        TEXT,
  medication      TEXT,
  dosage          TEXT,
  route           TEXT,
  administered_by TEXT,
  outcome         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Breed standard targets (extensible, overrides static data)
CREATE TABLE IF NOT EXISTS breed_standard_targets (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  breed                TEXT NOT NULL,
  species              TEXT NOT NULL,
  production           TEXT NOT NULL,
  age_unit             TEXT NOT NULL CHECK(age_unit IN ('day','week')),
  age                  INTEGER NOT NULL,
  body_wt_g            REAL,
  fcr                  REAL,
  adg_g                REAL,
  feed_per_bird_g      REAL,
  mortality_pct_max    REAL,
  egg_prod_pct         REAL,
  egg_wt_g             REAL,
  epi_min              REAL,
  warn_threshold_pct   REAL NOT NULL DEFAULT 5,
  alert_threshold_pct  REAL NOT NULL DEFAULT 10,
  source               TEXT,
  notes                TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(breed, age_unit, age)
);
