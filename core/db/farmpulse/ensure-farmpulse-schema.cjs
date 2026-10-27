'use strict';
/**
 * Create Farm Pulse tables and missing columns on every user database.
 * Works for local SQLite (better-sqlite3) and Turso / libSQL (NpDb).
 */

const CREATE_TABLES = [
  `CREATE TABLE IF NOT EXISTS farms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT,
    species TEXT NOT NULL,
    contact_name TEXT,
    contact_phone TEXT,
    capacity INTEGER,
    production_focus TEXT,
    housing_system TEXT,
    supervisor_name TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS flocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    flock_code TEXT NOT NULL,
    breed TEXT,
    production_type TEXT NOT NULL,
    initial_count INTEGER NOT NULL,
    placement_date TEXT NOT NULL,
    expected_end_date TEXT,
    actual_end_date TEXT,
    age_at_placement_weeks REAL,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS houses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    flock_id INTEGER,
    house_name TEXT NOT NULL,
    capacity INTEGER,
    area_m2 REAL,
    ventilation_type TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS feed_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    batch_code TEXT NOT NULL,
    formula_id INTEGER,
    formula_version TEXT,
    feed_phase TEXT,
    quantity_kg REAL NOT NULL,
    manufacture_date TEXT,
    delivery_date TEXT NOT NULL,
    expiry_date TEXT,
    supplier TEXT,
    mill_batch_ref TEXT,
    pellet_quality TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS daily_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flock_id INTEGER NOT NULL,
    house_id INTEGER NOT NULL,
    feed_batch_id INTEGER,
    record_date TEXT NOT NULL,
    bird_count INTEGER NOT NULL,
    age_days INTEGER,
    feed_intake_kg REAL,
    feed_intake_per_bird_g REAL,
    water_intake_l REAL,
    water_feed_ratio REAL,
    avg_body_weight_g REAL,
    target_body_weight_g REAL,
    uniformity_pct REAL,
    egg_count INTEGER,
    egg_production_pct REAL,
    avg_egg_weight_g REAL,
    egg_mass_g REAL,
    broken_eggs INTEGER,
    mortality_count INTEGER NOT NULL DEFAULT 0,
    cull_count INTEGER NOT NULL DEFAULT 0,
    cumulative_mortality INTEGER,
    temperature_c REAL,
    humidity_pct REAL,
    light_hours REAL,
    fcr REAL,
    fcr_period REAL,
    adg_g REAL,
    mortality_rate_pct REAL,
    epi REAL,
    std_body_wt_g REAL,
    std_fcr REAL,
    std_adg_g REAL,
    std_mortality_pct REAL,
    dev_body_wt_pct REAL,
    dev_fcr_pct REAL,
    dev_adg_pct REAL,
    dev_mortality_pct REAL,
    perf_status TEXT,
    alert_feed_drop INTEGER NOT NULL DEFAULT 0,
    alert_mortality_spike INTEGER NOT NULL DEFAULT 0,
    alert_water_spike INTEGER NOT NULL DEFAULT 0,
    alert_fcr_drift INTEGER NOT NULL DEFAULT 0,
    alert_std_deviation INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    bcs REAL,
    exercise_hours REAL,
    ammonia_ppm REAL,
    lameness_count INTEGER,
    scc REAL,
    diarrhoea_score REAL,
    respiratory_score REAL,
    floor_eggs INTEGER,
    milk_fat_pct REAL,
    milk_protein_pct REAL,
    entry_frequency TEXT DEFAULT 'daily',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS environmental_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    house_id INTEGER NOT NULL,
    flock_id INTEGER,
    logged_at TEXT NOT NULL DEFAULT (datetime('now')),
    temperature_c REAL,
    humidity_pct REAL,
    thi REAL,
    ammonia_ppm REAL,
    co2_ppm REAL,
    wind_speed_ms REAL,
    water_ph REAL,
    water_tds REAL,
    light_lux REAL,
    light_hours REAL,
    stocking_density_m2 REAL,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS body_weight_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flock_id INTEGER NOT NULL,
    house_id INTEGER NOT NULL,
    sample_date TEXT NOT NULL,
    age_days INTEGER,
    birds_weighed INTEGER NOT NULL,
    avg_weight_g REAL NOT NULL,
    min_weight_g REAL,
    max_weight_g REAL,
    cv_pct REAL,
    uniformity_pct REAL,
    std_weight_g REAL,
    dev_pct REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flock_id INTEGER NOT NULL,
    house_id INTEGER,
    alert_date TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    metric_value REAL,
    threshold_value REAL,
    status TEXT NOT NULL DEFAULT 'open',
    resolved_at TEXT,
    resolved_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS health_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flock_id INTEGER NOT NULL,
    house_id INTEGER,
    event_date TEXT NOT NULL,
    event_type TEXT NOT NULL,
    description TEXT,
    pathogen TEXT,
    medication TEXT,
    dosage TEXT,
    route TEXT,
    administered_by TEXT,
    outcome TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS egg_grading_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flock_id INTEGER NOT NULL,
    house_id INTEGER,
    grading_date TEXT NOT NULL,
    grade_aa INTEGER DEFAULT 0,
    grade_a INTEGER DEFAULT 0,
    grade_b INTEGER DEFAULT 0,
    grade_c INTEGER DEFAULT 0,
    cracked INTEGER DEFAULT 0,
    dirty INTEGER DEFAULT 0,
    total_graded INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS egg_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    flock_id INTEGER,
    txn_date TEXT NOT NULL,
    txn_type TEXT NOT NULL,
    grade TEXT,
    quantity INTEGER NOT NULL,
    unit_price REAL,
    reference_id INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS egg_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    flock_id INTEGER,
    sale_date TEXT NOT NULL,
    customer_name TEXT,
    grade TEXT,
    quantity_trays REAL NOT NULL,
    eggs_per_tray INTEGER DEFAULT 30,
    unit_price REAL NOT NULL,
    total_amount REAL,
    payment_status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS hatch_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    flock_id INTEGER,
    setter_id TEXT,
    set_date TEXT NOT NULL,
    eggs_set INTEGER NOT NULL,
    candling_date TEXT,
    infertile INTEGER DEFAULT 0,
    early_dead INTEGER DEFAULT 0,
    late_dead INTEGER DEFAULT 0,
    hatch_date TEXT,
    chicks_hatched INTEGER DEFAULT 0,
    culled_chicks INTEGER DEFAULT 0,
    fertility_pct REAL,
    hatchability_pct REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS chick_sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    hatch_record_id INTEGER,
    sale_date TEXT NOT NULL,
    customer_name TEXT,
    breed TEXT,
    sex TEXT,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total_amount REAL,
    delivery_address TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS medicine_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    product_type TEXT,
    active_ingredient TEXT,
    batch_no TEXT,
    expiry_date TEXT,
    quantity_units REAL NOT NULL DEFAULT 0,
    unit TEXT DEFAULT 'dose',
    unit_cost REAL,
    withdrawal_days INTEGER DEFAULT 0,
    supplier TEXT,
    storage_condition TEXT,
    status TEXT DEFAULT 'in_stock',
    reorder_level REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS medicine_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_id INTEGER NOT NULL,
    flock_id INTEGER,
    txn_date TEXT NOT NULL,
    txn_type TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_cost REAL,
    reason TEXT,
    administered_by TEXT,
    withdrawal_end_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS bird_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    house_id INTEGER,
    purchase_date TEXT NOT NULL,
    breed TEXT,
    production_type TEXT,
    sex TEXT,
    age_days INTEGER DEFAULT 0,
    quantity INTEGER NOT NULL,
    unit_price REAL,
    total_cost REAL,
    supplier_name TEXT,
    supplier_cert TEXT,
    health_status TEXT,
    health_cert_no TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS bird_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_date TEXT NOT NULL,
    from_farm_id INTEGER,
    from_house_id INTEGER,
    from_flock_id INTEGER,
    to_farm_id INTEGER,
    to_house_id INTEGER,
    to_flock_id INTEGER,
    quantity INTEGER NOT NULL,
    avg_weight_g REAL,
    reason TEXT,
    transfer_by TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS farm_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    flock_id INTEGER,
    expense_date TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    reference_no TEXT,
    paid_to TEXT,
    payment_method TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS breeder_sex_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flock_id INTEGER NOT NULL,
    house_id INTEGER,
    record_date TEXT NOT NULL,
    male_count INTEGER NOT NULL DEFAULT 0,
    female_count INTEGER NOT NULL DEFAULT 0,
    male_feed_kg REAL,
    female_feed_kg REAL,
    male_avg_weight_g REAL,
    female_avg_weight_g REAL,
    male_mortality INTEGER DEFAULT 0,
    female_mortality INTEGER DEFAULT 0,
    male_fcr REAL,
    female_fcr REAL,
    male_std_weight_g REAL,
    female_std_weight_g REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS slaughter_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    flock_id INTEGER,
    slaughter_date TEXT NOT NULL,
    birds_in INTEGER NOT NULL,
    live_weight_kg REAL,
    dead_on_arrival INTEGER DEFAULT 0,
    birds_slaughtered INTEGER,
    carcass_weight_kg REAL,
    yield_pct REAL,
    grade_a INTEGER DEFAULT 0,
    grade_b INTEGER DEFAULT 0,
    downgrade INTEGER DEFAULT 0,
    condemnations INTEGER DEFAULT 0,
    abattoir_name TEXT,
    slaughter_cost REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS processing_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slaughter_record_id INTEGER,
    farm_id INTEGER NOT NULL,
    process_date TEXT NOT NULL,
    product_type TEXT,
    quantity_units REAL NOT NULL,
    unit_weight_kg REAL,
    total_weight_kg REAL,
    unit_price REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS trade_customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_type TEXT,
    contact_name TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    credit_limit REAL DEFAULT 0,
    current_balance REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS live_bird_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farm_id INTEGER NOT NULL,
    flock_id INTEGER,
    customer_id INTEGER,
    trade_date TEXT NOT NULL,
    trade_type TEXT NOT NULL,
    birds_qty INTEGER NOT NULL,
    avg_live_weight_kg REAL,
    price_per_kg REAL NOT NULL,
    total_weight_kg REAL,
    total_amount REAL,
    weighbridge_ref TEXT,
    transport_cost REAL DEFAULT 0,
    payment_status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flock_id INTEGER,
    alert_id INTEGER,
    channel TEXT NOT NULL,
    recipient TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'sent',
    provider_sid TEXT,
    sent_at TEXT DEFAULT (datetime('now')),
    error_message TEXT
  )`
];

const INDEXES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_flock_house_date ON daily_records(flock_id, house_id, record_date)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_breeder_sex_flock_house_date ON breeder_sex_records(flock_id, house_id, record_date)`
];

const EXTRA_COLUMNS = {
  farms: [
    ['production_focus', 'TEXT'],
    ['housing_system', 'TEXT'],
    ['supervisor_name', 'TEXT']
  ],
  flocks: [
    ['age_at_placement_weeks', 'REAL']
  ],
  daily_records: [
    ['fcr', 'REAL'],
    ['fcr_period', 'REAL'],
    ['adg_g', 'REAL'],
    ['mortality_rate_pct', 'REAL'],
    ['epi', 'REAL'],
    ['bcs', 'REAL'],
    ['exercise_hours', 'REAL'],
    ['ammonia_ppm', 'REAL'],
    ['lameness_count', 'INTEGER'],
    ['scc', 'REAL'],
    ['diarrhoea_score', 'REAL'],
    ['respiratory_score', 'REAL'],
    ['floor_eggs', 'INTEGER'],
    ['milk_fat_pct', 'REAL'],
    ['milk_protein_pct', 'REAL'],
    ['entry_frequency', "TEXT DEFAULT 'daily'"]
  ]
};

function addColumnSync(db, table, col, def) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch (_) { /* exists */ }
}

async function addColumnAsync(db, table, col, def) {
  try { await db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`, []); } catch (_) { /* exists */ }
}

function backfillFcrSync(db) {
  try { db.exec(`UPDATE daily_records SET fcr_period = fcr WHERE fcr_period IS NULL AND fcr IS NOT NULL`); } catch (_) {}
}

async function backfillFcrAsync(db) {
  try { await db.run(`UPDATE daily_records SET fcr_period = fcr WHERE fcr_period IS NULL AND fcr IS NOT NULL`, []); } catch (_) {}
}

function rebuildFlocksWithoutTypeCheck(db) {
  let sql = '';
  try {
    sql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='flocks'`).get()?.sql || '';
  } catch (_) { return; }
  if (!sql || !/production_type[\s\S]{0,120}CHECK/i.test(sql)) return;
  try {
    const srcCols = db.prepare('PRAGMA table_info(flocks)').all().map((c) => c.name);
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec('DROP TABLE IF EXISTS flocks__new');
    db.exec(CREATE_TABLES.find((s) => s.includes('CREATE TABLE IF NOT EXISTS flocks'))
      .replace('CREATE TABLE IF NOT EXISTS flocks', 'CREATE TABLE flocks__new'));
    const destCols = db.prepare('PRAGMA table_info(flocks__new)').all().map((c) => c.name);
    const common = destCols.filter((c) => srcCols.includes(c));
    if (common.length) {
      const list = common.join(', ');
      db.exec(`INSERT INTO flocks__new (${list}) SELECT ${list} FROM flocks`);
    }
    db.exec('DROP TABLE flocks');
    db.exec('ALTER TABLE flocks__new RENAME TO flocks');
    db.exec('PRAGMA foreign_keys=ON');
  } catch (e) {
    try { db.exec('PRAGMA foreign_keys=ON'); } catch (_) {}
    console.error('[FarmPulse] flocks CHECK rebuild failed:', e?.message || e);
  }
}

function ensureFarmPulseSchemaSync(db) {
  if (!db) return;
  for (const sql of CREATE_TABLES) {
    try { db.exec(sql); } catch (e) {
      console.error('[FarmPulse] create table failed:', e?.message || e);
    }
  }
  for (const sql of INDEXES) {
    try { db.exec(sql); } catch (_) { /* ignore */ }
  }
  for (const [table, cols] of Object.entries(EXTRA_COLUMNS)) {
    for (const [col, def] of cols) addColumnSync(db, table, col, def);
  }
  backfillFcrSync(db);
  rebuildFlocksWithoutTypeCheck(db);
  return { ok: true };
}

async function ensureFarmPulseSchemaAsync(db) {
  if (!db) return { ok: false };
  for (const sql of CREATE_TABLES) {
    try { await db.exec(sql); } catch (e) {
      console.error('[FarmPulse] Turso create table failed:', e?.message || e);
    }
  }
  for (const sql of INDEXES) {
    try { await db.exec(sql); } catch (_) { /* ignore */ }
  }
  for (const [table, cols] of Object.entries(EXTRA_COLUMNS)) {
    for (const [col, def] of cols) await addColumnAsync(db, table, col, def);
  }
  await backfillFcrAsync(db);
  return { ok: true };
}

const tursoReady = new WeakSet();

async function ensureFarmPulseForRequest(req) {
  const user = String(req?.nutrixUser || req?.workspaceOwner || '').toLowerCase().trim();
  if (user) {
    try {
      const { getFarmPulseDb } = require('./farmpulse.db.cjs');
      getFarmPulseDb(user);
    } catch (e) {
      console.error('[FarmPulse] local schema ensure failed:', e?.message || e);
    }
  }
  if (req?.tursoClient && !tursoReady.has(req.tursoClient)) {
    try {
      const { NpDb } = await import('../../turso/turso.adapter.js');
      const np = new NpDb({ type: 'turso', client: req.tursoClient });
      await ensureFarmPulseSchemaAsync(np);
      tursoReady.add(req.tursoClient);
    } catch (e) {
      console.error('[FarmPulse] Turso schema ensure failed:', e?.message || e);
    }
  }
  return { ok: true };
}

module.exports = {
  ensureFarmPulseSchemaSync,
  ensureFarmPulseSchemaAsync,
  ensureFarmPulseForRequest
};
