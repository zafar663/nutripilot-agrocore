-- ============================================================
-- Feed Mill Intelligence Engine — SQLite Schema v1
-- nutripilot-agrocore/core/db/mill/mill.schema.sql
-- ============================================================

-- ── MILLS ────────────────────────────────────────────────────
-- One record per physical feed mill location
CREATE TABLE IF NOT EXISTS mill_mills (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  location          TEXT,
  timezone          TEXT DEFAULT 'UTC',
  currency          TEXT DEFAULT 'USD',
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

-- ── FORMULA SNAPSHOTS ────────────────────────────────────────
-- Frozen copy of the formula at the moment of release
-- Links batch back to exact NutriPilot formula version
CREATE TABLE IF NOT EXISTS mill_formula_snapshots (
  id                TEXT PRIMARY KEY,
  formula_id        TEXT NOT NULL,
  formula_version   TEXT NOT NULL,
  formula_name      TEXT NOT NULL,
  species           TEXT,
  feed_type         TEXT,
  released_by       TEXT NOT NULL,
  released_at       TEXT NOT NULL,
  formula_json      TEXT NOT NULL,        -- full formula snapshot as JSON string
  cost_per_ton      REAL,
  nutrients_json    TEXT,                 -- expected nutrient profile as JSON
  created_at        TEXT DEFAULT (datetime('now'))
);

-- ── BATCH JOBS ───────────────────────────────────────────────
-- One record per production batch
-- Status lifecycle: pending → confirmed → in_progress → completed → reviewed → dispatched
CREATE TABLE IF NOT EXISTS mill_batches (
  id                    TEXT PRIMARY KEY,
  mill_id               TEXT NOT NULL,
  formula_snapshot_id   TEXT NOT NULL,
  batch_number          TEXT,             -- human-readable batch number
  planned_qty_tons      REAL NOT NULL,
  actual_qty_tons       REAL,
  status                TEXT DEFAULT 'pending',
  priority              INTEGER DEFAULT 1,
  connector_source      TEXT DEFAULT 'manual_entry', -- opc_ua | rest_api | file_import | manual_entry
  operator_id           TEXT,
  notes                 TEXT,
  started_at            TEXT,
  completed_at          TEXT,
  reviewed_at           TEXT,
  dispatched_at         TEXT,
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (formula_snapshot_id) REFERENCES mill_formula_snapshots(id)
);

-- ── BATCH INGREDIENT ACTUALS ─────────────────────────────────
-- Planned vs actual per ingredient per batch
-- This is where formula deviation is calculated
CREATE TABLE IF NOT EXISTS mill_batch_ingredients (
  id                TEXT PRIMARY KEY,
  batch_id          TEXT NOT NULL,
  ingredient_id     TEXT NOT NULL,
  ingredient_name   TEXT NOT NULL,
  planned_kg        REAL NOT NULL,
  actual_kg         REAL,
  deviation_pct     REAL,                -- ((actual - planned) / planned) * 100
  cost_per_kg       REAL,
  planned_cost      REAL,
  actual_cost       REAL,
  cost_impact       REAL,                -- actual_cost - planned_cost
  deviation_flag    TEXT DEFAULT 'none', -- none | warn | flag
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (batch_id) REFERENCES mill_batches(id)
);

-- ── QC RESULTS ───────────────────────────────────────────────
-- Quality control test results per batch
CREATE TABLE IF NOT EXISTS mill_qc_results (
  id                TEXT PRIMARY KEY,
  batch_id          TEXT NOT NULL,
  moisture_pct      REAL,
  moisture_target   REAL,
  pdi_pct           REAL,                -- pellet durability index
  pdi_target        REAL,
  fines_pct         REAL,
  fines_target      REAL,
  protein_pct       REAL,                -- if lab tested
  protein_target    REAL,
  particle_size_mm  REAL,
  overall_status    TEXT DEFAULT 'pending', -- pending | pass | warn | fail | hold
  hold_reason       TEXT,
  release_decision  TEXT,                -- pass | rework | reject
  reviewed_by       TEXT,
  reviewed_at       TEXT,
  notes             TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (batch_id) REFERENCES mill_batches(id)
);

-- ── INVENTORY MOVEMENTS ──────────────────────────────────────
-- Daily stock tracking per ingredient
CREATE TABLE IF NOT EXISTS mill_inventory (
  id                TEXT PRIMARY KEY,
  mill_id           TEXT NOT NULL,
  ingredient_id     TEXT NOT NULL,
  ingredient_name   TEXT NOT NULL,
  record_date       TEXT NOT NULL,       -- YYYY-MM-DD
  opening           REAL DEFAULT 0,
  received          REAL DEFAULT 0,
  used              REAL DEFAULT 0,
  closing           REAL,
  expected_closing  REAL,               -- calculated from usage records
  variance          REAL,               -- closing - expected_closing
  variance_pct      REAL,
  cost_per_unit     REAL,
  shrinkage_value   REAL,               -- variance * cost_per_unit
  notes             TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

-- ── DOWNTIME EVENTS ──────────────────────────────────────────
-- Unplanned or planned production stops
CREATE TABLE IF NOT EXISTS mill_downtime_events (
  id                TEXT PRIMARY KEY,
  mill_id           TEXT NOT NULL,
  batch_id          TEXT,               -- linked batch if during production
  machine           TEXT NOT NULL,
  downtime_type     TEXT DEFAULT 'unplanned', -- planned | unplanned
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  duration_minutes  REAL,
  cause_category    TEXT,               -- mechanical | electrical | process | material | other
  cause_description TEXT,
  lost_tons         REAL,
  estimated_cost    REAL,
  resolved_by       TEXT,
  notes             TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);

-- ── DISPATCH RECORDS ─────────────────────────────────────────
-- Feed dispatched to farms or customers
CREATE TABLE IF NOT EXISTS mill_dispatch_records (
  id                TEXT PRIMARY KEY,
  batch_id          TEXT NOT NULL,
  mill_id           TEXT NOT NULL,
  customer_id       TEXT,
  farm_id           TEXT,               -- links to FarmPulse when ready
  customer_name     TEXT,
  quantity_tons     REAL NOT NULL,
  mill_mass         REAL,
  leftover_mass     REAL,
  silo_bin          TEXT,
  vehicle_id        TEXT,
  driver_name       TEXT,
  dispatched_at     TEXT NOT NULL,
  delivered_at      TEXT,
  delivery_status   TEXT DEFAULT 'pending', -- pending | in_transit | delivered | failed
  notes             TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (batch_id) REFERENCES mill_batches(id)
);

-- ── SUPPLIER LOTS ────────────────────────────────────────────
-- Raw material lots received from suppliers
CREATE TABLE IF NOT EXISTS mill_supplier_lots (
  id                TEXT PRIMARY KEY,
  mill_id           TEXT NOT NULL,
  supplier_id       TEXT NOT NULL,
  supplier_name     TEXT NOT NULL,
  ingredient_id     TEXT NOT NULL,
  ingredient_name   TEXT NOT NULL,
  lot_number        TEXT,
  received_date     TEXT NOT NULL,
  quantity_kg       REAL NOT NULL,
  price_per_kg      REAL,
  moisture_pct      REAL,
  protein_pct       REAL,
  qc_status         TEXT DEFAULT 'pending', -- pending | accepted | rejected | quarantine
  qc_notes          TEXT,
  storage_bin       TEXT,
  aflatoxin_ppb     REAL,
  don_ppb           REAL,
  ochratoxin_ppb    REAL,
  zearalenone_ppb   REAL,
  lock_status       TEXT DEFAULT 'open', -- open | locked
  lock_reason       TEXT,
  locked_at         TEXT,
  locked_by         TEXT,
  lab_cp            REAL,
  lab_me            REAL,
  created_at        TEXT DEFAULT (datetime('now'))
);

-- ── COMPLAINT RECORDS ────────────────────────────────────────
-- Farm or customer complaints linked back to batches
CREATE TABLE IF NOT EXISTS mill_complaints (
  id                TEXT PRIMARY KEY,
  batch_id          TEXT,
  dispatch_id       TEXT,
  farm_id           TEXT,
  customer_name     TEXT,
  complaint_type    TEXT,               -- quality | quantity | delivery | performance
  severity          TEXT DEFAULT 'medium', -- low | medium | high | critical
  description       TEXT NOT NULL,
  investigation     TEXT,
  root_cause        TEXT,
  resolved          INTEGER DEFAULT 0,
  resolved_at       TEXT,
  resolved_by       TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_batches_mill     ON mill_batches(mill_id);
CREATE INDEX IF NOT EXISTS idx_batches_status   ON mill_batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_snapshot ON mill_batches(formula_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_batch ON mill_batch_ingredients(batch_id);
CREATE INDEX IF NOT EXISTS idx_qc_batch         ON mill_qc_results(batch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_mill   ON mill_inventory(mill_id, record_date);
CREATE INDEX IF NOT EXISTS idx_dispatch_batch   ON mill_dispatch_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_lots_supplier    ON mill_supplier_lots(supplier_id);
CREATE INDEX IF NOT EXISTS idx_complaints_batch ON mill_complaints(batch_id);

-- ── MILL CONFIGURATIONS ──────────────────────────────────────
-- One record per physical feed mill
-- Stores identity, capacity, and connector settings
CREATE TABLE IF NOT EXISTS mill_configurations (
  id                    TEXT PRIMARY KEY,
  mill_name             TEXT NOT NULL,
  mill_code             TEXT UNIQUE,          -- short code e.g. MILL-001
  location              TEXT,
  country               TEXT,
  timezone              TEXT DEFAULT 'UTC',
  currency              TEXT DEFAULT 'USD',
  weight_unit           TEXT DEFAULT 'kg',
  -- kg | lb
  large_weight_unit     TEXT DEFAULT 'metric_ton',
  -- metric_ton | ton | lb
  price_basis           TEXT DEFAULT 'per_kg',
  -- per_kg | per_lb | per_metric_ton | per_ton | bags… (Ingredient Intelligence Apply)
  contact_name          TEXT,
  contact_phone         TEXT,
  contact_email         TEXT,

  -- Capacity
  capacity_tons_per_day REAL,
  default_batch_size_tons REAL DEFAULT 10,
  cost_per_minute_downtime REAL DEFAULT 8.50,
  operating_hours       REAL DEFAULT 16,
  shift_count           INTEGER DEFAULT 2,

  -- Connector type — determines how formula is sent and actuals received
  connector_type        TEXT DEFAULT 'manual_entry',
  -- manual_entry | file_exchange | rest_api | opc_ua

  -- File exchange config
  export_format         TEXT DEFAULT 'csv',
  -- csv | xml | xls | json
  watch_folder_path     TEXT,
  import_folder_path    TEXT,

  -- REST API config
  api_base_url          TEXT,
  api_key               TEXT,
  recipe_endpoint       TEXT,
  actuals_webhook_url   TEXT,

  -- OPC-UA config
  opc_server_url        TEXT,
  opc_namespace         INTEGER DEFAULT 2,
  opc_tag_map_json      TEXT,
  edge_agent_id         TEXT,

  -- Status
  is_active             INTEGER DEFAULT 1,
  notes                 TEXT,
  owner_username        TEXT,               -- account that owns this mill (per-user mill.db)
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now'))
);

-- ── WEIGHBRIDGE RECEIPTS ──────────────────────────────────────
-- Every ingredient receipt starts at the weighbridge
-- Net weight = gross_weight - tare_weight
-- Feeds directly into mill_inventory received (mill weight_unit)
CREATE TABLE IF NOT EXISTS mill_weighbridge_receipts (
  id                TEXT PRIMARY KEY,
  mill_id           TEXT NOT NULL,
  ingredient_id     TEXT NOT NULL,
  ingredient_name   TEXT NOT NULL,
  supplier_id       TEXT,
  supplier_name     TEXT,
  supplier_lot_id   TEXT,

  -- Weighbridge data
  vehicle_id        TEXT,
  driver_name       TEXT,
  gross_weight      REAL NOT NULL,
  tare_weight       REAL NOT NULL,
  net_weight        REAL GENERATED ALWAYS AS (gross_weight - tare_weight) STORED,

  -- Unit as recorded — same mill weight_unit as stock (no kg conversion)
  recorded_unit     TEXT DEFAULT 'kg',
  mill_mass         REAL NOT NULL,    -- net mass in mill.weight_unit

  -- Receipt details
  receipt_type      TEXT DEFAULT 'weighbridge',
  -- weighbridge | manual | transfer
  price_per_unit    REAL,
  price_unit        TEXT,             -- same as recorded_unit
  total_cost        REAL,
  currency          TEXT DEFAULT 'USD',

  -- QC at receipt
  moisture_pct      REAL,
  protein_pct       REAL,
  qc_status         TEXT DEFAULT 'pending',
  -- pending | accepted | rejected | quarantine
  qc_notes          TEXT,
  storage_bin       TEXT,

  -- Status
  receipt_date      TEXT NOT NULL,
  received_by       TEXT,
  notes             TEXT,
  inventory_updated INTEGER DEFAULT 0, -- 1 when posted to mill_inventory
  created_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_weighbridge_mill      ON mill_weighbridge_receipts(mill_id, receipt_date);
CREATE INDEX IF NOT EXISTS idx_weighbridge_ingredient ON mill_weighbridge_receipts(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_weighbridge_supplier   ON mill_weighbridge_receipts(supplier_id);

-- ── MILL INGREDIENT CATALOGUE ─────────────────────────────────
-- Per-plant ingredient settings
-- Links NutriPilot ingredient_id to plant-specific stock settings
CREATE TABLE IF NOT EXISTS mill_ingredient_catalogue (
  id                    TEXT PRIMARY KEY,
  mill_id               TEXT NOT NULL,
  ingredient_id         TEXT NOT NULL,     -- matches NutriPilot ingredient_id
  ingredient_name       TEXT NOT NULL,
  ingredient_code       TEXT,              -- plant-specific code if different

  -- Stock settings
  min_stock             REAL DEFAULT 0,    -- reorder point (mill weight_unit)
  max_stock             REAL,             -- max storage capacity
  reorder_qty           REAL,             -- standard order quantity
  lead_time_days        INTEGER DEFAULT 7, -- supplier lead time

  -- Display preferences
  display_unit          TEXT DEFAULT 'kg',
  -- kg | lb | metric_ton | ton

  -- Supplier preference
  preferred_supplier_id TEXT,
  preferred_supplier    TEXT,

  -- Status
  is_active             INTEGER DEFAULT 1,
  notes                 TEXT,
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now')),

  UNIQUE(mill_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_catalogue_mill       ON mill_ingredient_catalogue(mill_id);
CREATE INDEX IF NOT EXISTS idx_catalogue_ingredient ON mill_ingredient_catalogue(ingredient_id);

CREATE INDEX IF NOT EXISTS idx_mill_config_code ON mill_configurations(mill_code);
CREATE INDEX IF NOT EXISTS idx_mill_config_active ON mill_configurations(is_active);

-- ============================================================
-- Price Lists
-- ============================================================

CREATE TABLE IF NOT EXISTS price_lists (
  id              TEXT PRIMARY KEY,
  mill_id         TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  status          TEXT DEFAULT 'draft',
  created_by      TEXT NOT NULL,
  created_by_role TEXT DEFAULT 'purchaser',
  activated_by    TEXT,
  activated_at    TEXT,
  archived_at     TEXT,
  valid_from      TEXT,
  valid_to        TEXT,
  notes           TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS price_list_items (
  id                TEXT PRIMARY KEY,
  price_list_id     TEXT NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  mill_id           TEXT NOT NULL,
  ingredient_code   TEXT NOT NULL,
  ingredient_name   TEXT NOT NULL,
  ingredient_id     TEXT,
  price_per_unit    REAL NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  weight_unit       TEXT NOT NULL DEFAULT 'mt',
  exchange_rate     REAL DEFAULT 1,
  price_per_kg_usd  REAL,
  supplier          TEXT,
  effective_date    TEXT,
  notes             TEXT,
  submitted_by      TEXT,
  approved_by       TEXT,
  approved_at       TEXT,
  status            TEXT DEFAULT 'pending',
  rejection_note    TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_price_lists_mill ON price_lists(mill_id);
CREATE INDEX IF NOT EXISTS idx_price_list_items_list ON price_list_items(price_list_id);
CREATE INDEX IF NOT EXISTS idx_price_list_items_code ON price_list_items(ingredient_code);