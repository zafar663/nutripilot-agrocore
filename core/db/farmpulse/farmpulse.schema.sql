-- â”€â”€â”€ FarmPulse SQLite Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Farms
CREATE TABLE IF NOT EXISTS farms (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  location      TEXT,
  species       TEXT NOT NULL,
  contact_name  TEXT,
  contact_phone TEXT,
  capacity      INTEGER,
  production_focus TEXT,
  housing_system TEXT,
  supervisor_name TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Houses
CREATE TABLE IF NOT EXISTS houses (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id          INTEGER NOT NULL REFERENCES farms(id),
  flock_id         INTEGER REFERENCES flocks(id) DEFERRABLE INITIALLY DEFERRED,
  house_name       TEXT NOT NULL,
  capacity         INTEGER,
  area_m2          REAL,
  ventilation_type TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Flocks
CREATE TABLE IF NOT EXISTS flocks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id           INTEGER NOT NULL REFERENCES farms(id),
  flock_code        TEXT NOT NULL,
  breed             TEXT,
  production_type   TEXT NOT NULL,
  initial_count     INTEGER NOT NULL,
  placement_date    TEXT NOT NULL,
  expected_end_date TEXT,
  actual_end_date   TEXT,
  age_at_placement_weeks REAL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','transferred')),
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Feed batches (linked to mill batches via mill_batch_ref)
CREATE TABLE IF NOT EXISTS feed_batches (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id          INTEGER NOT NULL REFERENCES farms(id),
  batch_code       TEXT NOT NULL,
  formula_id       INTEGER,
  formula_version  TEXT,
  feed_phase       TEXT CHECK(feed_phase IN ('starter','grower','finisher','layer','developer')),
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

-- Daily production records
CREATE TABLE IF NOT EXISTS daily_records (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  flock_id               INTEGER NOT NULL REFERENCES flocks(id),
  house_id               INTEGER NOT NULL REFERENCES houses(id),
  feed_batch_id          INTEGER REFERENCES feed_batches(id),
  record_date            TEXT NOT NULL,
  bird_count             INTEGER NOT NULL,
  age_days               INTEGER,
  -- Feed
  feed_intake_kg         REAL,
  feed_intake_per_bird_g REAL,
  -- Water
  water_intake_l         REAL,
  water_feed_ratio       REAL,
  -- Growth
  avg_body_weight_g      REAL,
  target_body_weight_g   REAL,
  uniformity_pct         REAL,
  -- Eggs (layers)
  egg_count              INTEGER,
  egg_production_pct     REAL,
  avg_egg_weight_g       REAL,
  egg_mass_g             REAL,
  broken_eggs            INTEGER,
  -- Mortality
  mortality_count        INTEGER NOT NULL DEFAULT 0,
  cull_count             INTEGER NOT NULL DEFAULT 0,
  cumulative_mortality   INTEGER,
  -- Environment (snapshot at record time)
  temperature_c          REAL,
  humidity_pct           REAL,
  light_hours            REAL,
  -- Computed KPIs (auto-calculated on save)
  fcr                    REAL,
  fcr_period             REAL,
  adg_g                  REAL,
  mortality_rate_pct     REAL,
  epi                    REAL,
  -- Breed standard deviation (filled by perf engine)
  std_body_wt_g          REAL,
  std_fcr                REAL,
  std_adg_g              REAL,
  std_mortality_pct      REAL,
  dev_body_wt_pct        REAL,
  dev_fcr_pct            REAL,
  dev_adg_pct            REAL,
  dev_mortality_pct      REAL,
  perf_status            TEXT CHECK(perf_status IN ('OK','WARN','FAIL')),
  -- Alert flags
  alert_feed_drop        INTEGER NOT NULL DEFAULT 0,
  alert_mortality_spike  INTEGER NOT NULL DEFAULT 0,
  alert_water_spike      INTEGER NOT NULL DEFAULT 0,
  alert_fcr_drift        INTEGER NOT NULL DEFAULT 0,
  alert_std_deviation    INTEGER NOT NULL DEFAULT 0,
  notes                  TEXT,
  bcs                    REAL,
  exercise_hours         REAL,
  ammonia_ppm            REAL,
  lameness_count         INTEGER,
  scc                    REAL,
  diarrhoea_score        REAL,
  respiratory_score      REAL,
  floor_eggs             INTEGER,
  milk_fat_pct           REAL,
  milk_protein_pct       REAL,
  entry_frequency        TEXT DEFAULT 'daily',
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_flock_house_date
  ON daily_records(flock_id, house_id, record_date);

-- Environmental logs (detailed, multiple per day)
CREATE TABLE IF NOT EXISTS environmental_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  house_id        INTEGER NOT NULL REFERENCES houses(id),
  flock_id        INTEGER REFERENCES flocks(id),
  logged_at       TEXT NOT NULL DEFAULT (datetime('now')),
  temperature_c   REAL,
  humidity_pct    REAL,
  thi             REAL,
  ammonia_ppm     REAL,
  co2_ppm         REAL,
  wind_speed_ms   REAL,
  water_ph        REAL,
  water_tds       REAL,
  light_lux       REAL,
  light_hours     REAL,
  stocking_density_m2 REAL,
  notes           TEXT
);

-- Body weight samples (individual weighing records)
CREATE TABLE IF NOT EXISTS body_weight_samples (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  flock_id        INTEGER NOT NULL REFERENCES flocks(id),
  house_id        INTEGER NOT NULL REFERENCES houses(id),
  sample_date     TEXT NOT NULL,
  age_days        INTEGER,
  birds_weighed   INTEGER NOT NULL,
  avg_weight_g    REAL NOT NULL,
  min_weight_g    REAL,
  max_weight_g    REAL,
  cv_pct          REAL,
  uniformity_pct  REAL,
  std_weight_g    REAL,
  dev_pct         REAL,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  flock_id        INTEGER NOT NULL REFERENCES flocks(id),
  house_id        INTEGER REFERENCES houses(id),
  alert_date      TEXT NOT NULL,
  alert_type      TEXT NOT NULL CHECK(alert_type IN (
                    'feed_drop','mortality_spike','water_spike','fcr_drift',
                    'production_drop','std_deviation','heat_stress',
                    'weight_lag','uniformity_drop')),
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
  event_type      TEXT NOT NULL CHECK(event_type IN ('vaccination','disease','medication','necropsy','treatment','sampling')),
  description     TEXT,
  pathogen        TEXT,
  medication      TEXT,
  dosage          TEXT,
  route           TEXT,
  administered_by TEXT,
  outcome         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ════════════════════════════════════════════════════════════════════
-- POULSOFT-PARITY ADDITIONS
-- ════════════════════════════════════════════════════════════════════

-- Egg grading records (Feature 1)
CREATE TABLE IF NOT EXISTS egg_grading_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  flock_id        INTEGER NOT NULL REFERENCES flocks(id),
  house_id        INTEGER REFERENCES houses(id),
  grading_date    TEXT NOT NULL,
  grade_aa        INTEGER DEFAULT 0,
  grade_a         INTEGER DEFAULT 0,
  grade_b         INTEGER DEFAULT 0,
  grade_c         INTEGER DEFAULT 0,
  cracked         INTEGER DEFAULT 0,
  dirty           INTEGER DEFAULT 0,
  total_graded    INTEGER GENERATED ALWAYS AS (grade_aa + grade_a + grade_b + grade_c + cracked + dirty) VIRTUAL,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Egg inventory / cold-room transactions (Feature 1)
CREATE TABLE IF NOT EXISTS egg_inventory (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id         INTEGER NOT NULL REFERENCES farms(id),
  flock_id        INTEGER REFERENCES flocks(id),
  txn_date        TEXT NOT NULL,
  txn_type        TEXT NOT NULL CHECK(txn_type IN ('stock_in','sale','damage','transfer','adjustment')),
  grade           TEXT CHECK(grade IN ('AA','A','B','C','cracked','dirty')),
  quantity        INTEGER NOT NULL,
  unit_price      REAL,
  reference_id    INTEGER,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Egg sales (Feature 1)
CREATE TABLE IF NOT EXISTS egg_sales (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id         INTEGER NOT NULL REFERENCES farms(id),
  flock_id        INTEGER REFERENCES flocks(id),
  sale_date       TEXT NOT NULL,
  customer_name   TEXT,
  grade           TEXT,
  quantity_trays  REAL NOT NULL,
  eggs_per_tray   INTEGER DEFAULT 30,
  unit_price      REAL NOT NULL,
  total_amount    REAL GENERATED ALWAYS AS (quantity_trays * unit_price) VIRTUAL,
  payment_status  TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','partial')),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Hatchery — tray setting / incubation records (Feature 2)
CREATE TABLE IF NOT EXISTS hatch_records (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id           INTEGER NOT NULL REFERENCES farms(id),
  flock_id          INTEGER REFERENCES flocks(id),
  setter_id         TEXT,
  set_date          TEXT NOT NULL,
  eggs_set          INTEGER NOT NULL,
  candling_date     TEXT,
  infertile         INTEGER DEFAULT 0,
  early_dead        INTEGER DEFAULT 0,
  late_dead         INTEGER DEFAULT 0,
  hatch_date        TEXT,
  chicks_hatched    INTEGER DEFAULT 0,
  culled_chicks     INTEGER DEFAULT 0,
  fertility_pct     REAL GENERATED ALWAYS AS (CASE WHEN eggs_set > 0 THEN ROUND((CAST(eggs_set - infertile AS REAL)/eggs_set)*100,2) ELSE NULL END) VIRTUAL,
  hatchability_pct  REAL,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chick sales from hatchery (Feature 2)
CREATE TABLE IF NOT EXISTS chick_sales (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id         INTEGER NOT NULL REFERENCES farms(id),
  hatch_record_id INTEGER REFERENCES hatch_records(id),
  sale_date       TEXT NOT NULL,
  customer_name   TEXT,
  breed           TEXT,
  sex             TEXT CHECK(sex IN ('male','female','straight_run')),
  quantity        INTEGER NOT NULL,
  unit_price      REAL NOT NULL,
  total_amount    REAL GENERATED ALWAYS AS (quantity * unit_price) VIRTUAL,
  delivery_address TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Medicine / vaccine inventory (Feature 3)
CREATE TABLE IF NOT EXISTS medicine_inventory (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id          INTEGER NOT NULL REFERENCES farms(id),
  product_name     TEXT NOT NULL,
  product_type     TEXT CHECK(product_type IN ('vaccine','antibiotic','vitamin','probiotic','other')),
  active_ingredient TEXT,
  batch_no         TEXT,
  expiry_date      TEXT,
  quantity_units   REAL NOT NULL DEFAULT 0,
  unit             TEXT DEFAULT 'dose',
  unit_cost        REAL,
  withdrawal_days  INTEGER DEFAULT 0,
  supplier         TEXT,
  storage_condition TEXT,
  status           TEXT DEFAULT 'in_stock' CHECK(status IN ('in_stock','low','out_of_stock','expired')),
  reorder_level    REAL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Medicine transactions (purchase + usage) (Feature 3)
CREATE TABLE IF NOT EXISTS medicine_transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  medicine_id     INTEGER NOT NULL REFERENCES medicine_inventory(id),
  flock_id        INTEGER REFERENCES flocks(id),
  txn_date        TEXT NOT NULL,
  txn_type        TEXT NOT NULL CHECK(txn_type IN ('purchase','usage','disposal','adjustment')),
  quantity        REAL NOT NULL,
  unit_cost       REAL,
  reason          TEXT,
  administered_by TEXT,
  withdrawal_end_date TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bird purchases (Feature 4)
CREATE TABLE IF NOT EXISTS bird_purchases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id         INTEGER NOT NULL REFERENCES farms(id),
  house_id        INTEGER REFERENCES houses(id),
  purchase_date   TEXT NOT NULL,
  breed           TEXT,
  production_type TEXT,
  sex             TEXT CHECK(sex IN ('male','female','straight_run')),
  age_days        INTEGER DEFAULT 0,
  quantity        INTEGER NOT NULL,
  unit_price      REAL,
  total_cost      REAL GENERATED ALWAYS AS (quantity * unit_price) VIRTUAL,
  supplier_name   TEXT,
  supplier_cert   TEXT,
  health_status   TEXT,
  health_cert_no  TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bird transfers between farms/houses (Feature 4)
CREATE TABLE IF NOT EXISTS bird_transfers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_date   TEXT NOT NULL,
  from_farm_id    INTEGER REFERENCES farms(id),
  from_house_id   INTEGER REFERENCES houses(id),
  from_flock_id   INTEGER REFERENCES flocks(id),
  to_farm_id      INTEGER REFERENCES farms(id),
  to_house_id     INTEGER REFERENCES houses(id),
  to_flock_id     INTEGER REFERENCES flocks(id),
  quantity        INTEGER NOT NULL,
  avg_weight_g    REAL,
  reason          TEXT,
  transfer_by     TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Farm expenses ledger (Feature 5)
CREATE TABLE IF NOT EXISTS farm_expenses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id         INTEGER NOT NULL REFERENCES farms(id),
  flock_id        INTEGER REFERENCES flocks(id),
  expense_date    TEXT NOT NULL,
  category        TEXT NOT NULL CHECK(category IN ('chick_cost','feed','medicine','labour','utilities','maintenance','overhead','equipment','transport','other')),
  description     TEXT NOT NULL,
  amount          REAL NOT NULL,
  reference_no    TEXT,
  paid_to         TEXT,
  payment_method  TEXT CHECK(payment_method IN ('cash','bank','credit','other')),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Breeder sex-based records (Feature 6)
CREATE TABLE IF NOT EXISTS breeder_sex_records (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  flock_id          INTEGER NOT NULL REFERENCES flocks(id),
  house_id          INTEGER REFERENCES houses(id),
  record_date       TEXT NOT NULL,
  male_count        INTEGER NOT NULL DEFAULT 0,
  female_count      INTEGER NOT NULL DEFAULT 0,
  male_feed_kg      REAL,
  female_feed_kg    REAL,
  male_avg_weight_g REAL,
  female_avg_weight_g REAL,
  male_mortality    INTEGER DEFAULT 0,
  female_mortality  INTEGER DEFAULT 0,
  male_fcr          REAL,
  female_fcr        REAL,
  male_std_weight_g REAL,
  female_std_weight_g REAL,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_breeder_sex_flock_house_date
  ON breeder_sex_records(flock_id, house_id, record_date);

-- Slaughter / processing records (Feature 8)
CREATE TABLE IF NOT EXISTS slaughter_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id         INTEGER NOT NULL REFERENCES farms(id),
  flock_id        INTEGER REFERENCES flocks(id),
  slaughter_date  TEXT NOT NULL,
  birds_in        INTEGER NOT NULL,
  live_weight_kg  REAL,
  dead_on_arrival INTEGER DEFAULT 0,
  birds_slaughtered INTEGER,
  carcass_weight_kg REAL,
  yield_pct       REAL GENERATED ALWAYS AS (CASE WHEN live_weight_kg > 0 THEN ROUND((carcass_weight_kg/live_weight_kg)*100,2) ELSE NULL END) VIRTUAL,
  grade_a         INTEGER DEFAULT 0,
  grade_b         INTEGER DEFAULT 0,
  downgrade       INTEGER DEFAULT 0,
  condemnations   INTEGER DEFAULT 0,
  abattoir_name   TEXT,
  slaughter_cost  REAL,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Processing / portioning records (Feature 8)
CREATE TABLE IF NOT EXISTS processing_records (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  slaughter_record_id INTEGER REFERENCES slaughter_records(id),
  farm_id             INTEGER NOT NULL REFERENCES farms(id),
  process_date        TEXT NOT NULL,
  product_type        TEXT CHECK(product_type IN ('whole_carcass','breast','thigh','drumstick','wing','offal','rendering','other')),
  quantity_units      REAL NOT NULL,
  unit_weight_kg      REAL,
  total_weight_kg     REAL GENERATED ALWAYS AS (quantity_units * unit_weight_kg) VIRTUAL,
  unit_price          REAL,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CTS — trade customers (Feature 10)
CREATE TABLE IF NOT EXISTS trade_customers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name   TEXT NOT NULL,
  customer_type   TEXT CHECK(customer_type IN ('trader','retailer','processor','farmer','other')),
  contact_name    TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  credit_limit    REAL DEFAULT 0,
  current_balance REAL DEFAULT 0,
  status          TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','blacklisted')),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- CTS — live bird trade records (Feature 10)
CREATE TABLE IF NOT EXISTS live_bird_trades (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  farm_id         INTEGER NOT NULL REFERENCES farms(id),
  flock_id        INTEGER REFERENCES flocks(id),
  customer_id     INTEGER REFERENCES trade_customers(id),
  trade_date      TEXT NOT NULL,
  trade_type      TEXT NOT NULL CHECK(trade_type IN ('sale','purchase')),
  birds_qty       INTEGER NOT NULL,
  avg_live_weight_kg REAL,
  price_per_kg    REAL NOT NULL,
  total_weight_kg REAL,
  total_amount    REAL,
  weighbridge_ref TEXT,
  transport_cost  REAL DEFAULT 0,
  payment_status  TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending','partial','paid')),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- SMS/Alert notification log (Feature 9)
CREATE TABLE IF NOT EXISTS notification_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  flock_id        INTEGER REFERENCES flocks(id),
  alert_id        INTEGER REFERENCES alerts(id),
  channel         TEXT NOT NULL CHECK(channel IN ('sms','whatsapp','email')),
  recipient       TEXT NOT NULL,
  message         TEXT NOT NULL,
  status          TEXT DEFAULT 'sent' CHECK(status IN ('sent','failed','pending')),
  provider_sid    TEXT,
  sent_at         TEXT DEFAULT (datetime('now')),
  error_message   TEXT
);