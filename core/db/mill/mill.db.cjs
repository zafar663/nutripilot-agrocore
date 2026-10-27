'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { runWithWorkspaceUser, currentWorkspaceUser } = require('../workspace-context.cjs');
const { encodeUsername: encodeUserFolder } = require('../../lib/normalize-email.cjs');

const DATA_ROOT = path.join(__dirname, '..', '..', '..', 'data');
const USERS_ROOT = path.join(DATA_ROOT, 'users');
const LEGACY_MILL_PATH = path.join(DATA_ROOT, 'mill.db');
const SCHEMA_PATH = path.join(__dirname, 'mill.schema.sql');
const INDEX_PATH = path.join(DATA_ROOT, 'mill-inbound-index.db');

const dbCache = Object.create(null);
let _legacyDb = null;
let _indexDb = null;

function encodeUsername(username) {
  return encodeUserFolder(username);
}

function runWithMillUser(user, fn) {
  return runWithWorkspaceUser(user, fn);
}

function currentMillUser() {
  return currentWorkspaceUser();
}

function tableCols(db, table) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name); }
  catch (_e) { return []; }
}

function renameCol(db, table, from, to) {
  const cols = tableCols(db, table);
  if (!cols.includes(from) || cols.includes(to)) return;
  try {
    db.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
    console.log(`[MillDB] ${table}.${from} → ${to}`);
  } catch (e) {
    console.warn(`[MillDB] could not rename ${table}.${from}:`, e.message);
  }
}

function migrateMillMassColumnNames(db) {
  renameCol(db, 'mill_weighbridge_receipts', 'net_weight_kg', 'mill_mass');
  renameCol(db, 'mill_inventory', 'opening_kg', 'opening');
  renameCol(db, 'mill_inventory', 'received_kg', 'received');
  renameCol(db, 'mill_inventory', 'used_kg', 'used');
  renameCol(db, 'mill_inventory', 'closing_kg', 'closing');
  renameCol(db, 'mill_inventory', 'variance_kg', 'variance');
  renameCol(db, 'mill_inventory', 'cost_per_kg', 'cost_per_unit');
  renameCol(db, 'mill_ingredient_catalogue', 'min_stock_kg', 'min_stock');
  renameCol(db, 'mill_ingredient_catalogue', 'max_stock_kg', 'max_stock');
  renameCol(db, 'mill_ingredient_catalogue', 'reorder_qty_kg', 'reorder_qty');
}

function initSchema(db) {
  if (fs.existsSync(SCHEMA_PATH)) {
    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  }
  try { db.exec('ALTER TABLE mill_configurations ADD COLUMN owner_username TEXT'); } catch (_e) {}
  try { db.exec("ALTER TABLE mill_configurations ADD COLUMN price_basis TEXT DEFAULT 'per_kg'"); } catch (_e) {}
  migrateMillMassColumnNames(db);
  for (const [col, def] of [
    ['silo_bin', 'TEXT'],
    ['mill_mass', 'REAL'],
    ['leftover_mass', 'REAL'],
    ['lot_numbers', 'TEXT']
  ]) {
    try { db.exec(`ALTER TABLE mill_dispatch_records ADD COLUMN ${col} ${def}`); } catch (_e) {}
  }
  try { db.exec(`ALTER TABLE mill_batch_ingredients ADD COLUMN lot_number TEXT`); } catch (_e) {}
  try { db.exec(`ALTER TABLE mill_batch_ingredients ADD COLUMN silo_bin TEXT`); } catch (_e) {}
  try { db.exec(`ALTER TABLE mill_weighbridge_receipts ADD COLUMN lot_number TEXT`); } catch (_e) {}
  for (const [col, def] of [
    ['photo_path', 'TEXT'],
    ['photo_data', 'TEXT'],
    ['gate_status', 'TEXT'],
    ['gate_missing', 'TEXT'],
    ['gate_override_by', 'TEXT'],
    ['gate_override_reason', 'TEXT']
  ]) {
    try { db.exec(`ALTER TABLE mill_weighbridge_receipts ADD COLUMN ${col} ${def}`); } catch (_e) {}
  }
  try { db.exec(`ALTER TABLE mill_ingredient_catalogue ADD COLUMN price_per_kg REAL`); } catch (_e) {}
  db.exec(`
    CREATE TABLE IF NOT EXISTS mill_flush_log (
      id TEXT PRIMARY KEY, mill_id TEXT NOT NULL, from_batch_id TEXT, to_batch_id TEXT,
      from_species TEXT, to_species TEXT, flush_required INTEGER DEFAULT 0, flush_done INTEGER DEFAULT 0,
      signed_by TEXT, signed_at TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mill_haccp_signoff (
      id TEXT PRIMARY KEY, mill_id TEXT NOT NULL, batch_id TEXT, ccp TEXT NOT NULL,
      passed INTEGER DEFAULT 0, signed_by TEXT, signed_at TEXT, notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mill_process_qc (
      id TEXT PRIMARY KEY, mill_id TEXT NOT NULL, batch_id TEXT,
      grind_size_mm REAL, conditioner_temp REAL, pellet_temp REAL, pdi_pct REAL, kwh_per_ton REAL,
      notes TEXT, recorded_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function getInboundIndexDb() {
  if (_indexDb) return _indexDb;
  if (!fs.existsSync(DATA_ROOT)) fs.mkdirSync(DATA_ROOT, { recursive: true });
  _indexDb = new Database(INDEX_PATH);
  _indexDb.pragma('journal_mode = WAL');
  _indexDb.exec(`
    CREATE TABLE IF NOT EXISTS mill_inbound_index (
      mill_id TEXT PRIMARY KEY,
      owner_username TEXT NOT NULL,
      ingest_token TEXT NOT NULL,
      updated_at TEXT
    )
  `);
  return _indexDb;
}

function upsertInboundIndex(mill_id, owner_username, ingest_token) {
  const owner = String(owner_username || '').toLowerCase().trim();
  if (!mill_id || !owner || !ingest_token) return;
  getInboundIndexDb().prepare(`
    INSERT INTO mill_inbound_index (mill_id, owner_username, ingest_token, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(mill_id) DO UPDATE SET
      owner_username = excluded.owner_username,
      ingest_token = excluded.ingest_token,
      updated_at = excluded.updated_at
  `).run(mill_id, owner, ingest_token);
}

function ensureInboundPulseCols() {
  const db = getInboundIndexDb();
  for (const col of ['last_ok_at', 'last_fail_at', 'last_error', 'last_kind', 'last_file']) {
    try { db.exec(`ALTER TABLE mill_inbound_index ADD COLUMN ${col} TEXT`); } catch (_e) {}
  }
}

function recordInboundPulse(mill_id, { ok, kind, error, file } = {}) {
  if (!mill_id) return;
  ensureInboundPulseCols();
  const db = getInboundIndexDb();
  const row = db.prepare('SELECT mill_id FROM mill_inbound_index WHERE mill_id = ?').get(mill_id);
  if (!row) {
    db.prepare(`
      INSERT INTO mill_inbound_index (mill_id, owner_username, ingest_token, updated_at)
      VALUES (?, '', '', datetime('now'))
    `).run(mill_id);
  }
  const now = new Date().toISOString();
  if (ok) {
    db.prepare(`
      UPDATE mill_inbound_index SET
        last_ok_at = ?, last_kind = ?, last_file = ?, last_error = NULL
      WHERE mill_id = ?
    `).run(now, kind || null, file ? String(file).slice(0, 200) : null, mill_id);
  } else {
    db.prepare(`
      UPDATE mill_inbound_index SET
        last_fail_at = ?, last_kind = ?, last_file = ?, last_error = ?
      WHERE mill_id = ?
    `).run(now, kind || null, file ? String(file).slice(0, 200) : null, error ? String(error).slice(0, 400) : null, mill_id);
  }
}

function getInboundPulse(mill_id) {
  if (!mill_id) return { mill_id: null, last_ok_at: null, last_fail_at: null, last_error: null, last_kind: null, last_file: null };
  ensureInboundPulseCols();
  const row = getInboundIndexDb().prepare(`
    SELECT mill_id, last_ok_at, last_fail_at, last_error, last_kind, last_file
    FROM mill_inbound_index WHERE mill_id = ?
  `).get(mill_id);
  return row || { mill_id, last_ok_at: null, last_fail_at: null, last_error: null, last_kind: null, last_file: null };
}

function retireInboundToken(mill_id, owner) {
  const next = require('crypto').randomUUID().replace(/-/g, '').slice(0, 20);
  getInboundIndexDb().prepare(
    `UPDATE mill_inbound_index SET ingest_token = ?, updated_at = datetime('now') WHERE mill_id = ?`
  ).run(next, mill_id);
  if (owner) {
    try {
      runWithMillUser(owner, () => {
        const db = getMillDb();
        db.prepare(
          `UPDATE mill_inbound_map SET ingest_token = ?, updated_at = ? WHERE mill_id = ?`
        ).run(next, new Date().toISOString(), mill_id);
      });
    } catch (_e) { /* index token is already dead */ }
  }
  return next;
}

function lookupInboundOwner(mill_id, token) {
  if (!mill_id || !token) return null;
  const idx = getInboundIndexDb().prepare(
    'SELECT owner_username, ingest_token FROM mill_inbound_index WHERE mill_id = ?'
  ).get(mill_id);
  if (idx && idx.ingest_token === token) return String(idx.owner_username).toLowerCase();

  try {
    const legacy = getLegacySharedMillDb();
    let cfg = null;
    try { cfg = legacy.prepare('SELECT ingest_token FROM mill_inbound_map WHERE mill_id = ?').get(mill_id); } catch (_e) {}
    if (!cfg || cfg.ingest_token !== token) return null;
    let mill = null;
    try { mill = legacy.prepare('SELECT owner_username FROM mill_configurations WHERE id = ?').get(mill_id); } catch (_e) {}
    const owner = mill && mill.owner_username ? String(mill.owner_username).toLowerCase() : null;
    if (owner) upsertInboundIndex(mill_id, owner, token);
    return owner;
  } catch (_e) {
    return null;
  }
}

function getLegacySharedMillDb() {
  if (_legacyDb) return _legacyDb;
  if (!fs.existsSync(LEGACY_MILL_PATH)) return null;
  _legacyDb = new Database(LEGACY_MILL_PATH);
  _legacyDb.pragma('journal_mode = WAL');
  return _legacyDb;
}

function sqlPath(p) {
  return String(p).replace(/'/g, "''");
}

function copyUserMillsFromLegacy(userDb, owner) {
  const legacy = getLegacySharedMillDb();
  if (!legacy) return;
  const mills = (() => {
    try {
      return legacy.prepare(
        `SELECT id FROM mill_configurations WHERE LOWER(IFNULL(owner_username,'')) = ?`
      ).all(owner);
    } catch (_e) { return []; }
  })();
  if (!mills.length) return;

  const ids = mills.map(m => m.id);
  const ph = ids.map(() => '?').join(',');
  userDb.exec(`ATTACH DATABASE '${sqlPath(LEGACY_MILL_PATH)}' AS legacy`);
  try {
    const copyWhere = (table, where, params) => {
      try {
        const destCols = userDb.prepare(`PRAGMA table_info(${table})`).all()
          .map(c => c.name)
          .filter(n => n !== 'net_weight');
        let legacyCols = destCols;
        try {
          legacyCols = userDb.prepare(`PRAGMA legacy.table_info(${table})`).all().map(c => c.name);
        } catch (_e) {}
        const legacySet = new Set(legacyCols);
        const cols = destCols.filter(n => legacySet.has(n));
        if (!cols.length) return;
        const list = cols.join(',');
        userDb.prepare(
          `INSERT OR IGNORE INTO ${table} (${list}) SELECT ${list} FROM legacy.${table} WHERE ${where}`
        ).run(...params);
      } catch (e) {
        console.warn(`[MillDB] copy ${table}:`, e.message);
      }
    };

    copyWhere('mill_configurations', `id IN (${ph})`, ids);
    copyWhere('mill_batches', `mill_id IN (${ph})`, ids);
    copyWhere('mill_inventory', `mill_id IN (${ph})`, ids);
    copyWhere('mill_weighbridge_receipts', `mill_id IN (${ph})`, ids);
    copyWhere('mill_ingredient_catalogue', `mill_id IN (${ph})`, ids);
    copyWhere('mill_downtime_events', `mill_id IN (${ph})`, ids);
    copyWhere('mill_dispatch_records', `mill_id IN (${ph})`, ids);
    copyWhere('mill_supplier_lots', `mill_id IN (${ph})`, ids);
    copyWhere('mill_complaints', `mill_id IN (${ph})`, ids);
    copyWhere('mill_inbound_map', `mill_id IN (${ph})`, ids);
    copyWhere('mill_formula_snapshots', '1=1', []);
    try {
      userDb.exec(`CREATE TABLE IF NOT EXISTS ingredient_intelligence_library (
        id TEXT PRIMARY KEY,
        mill_id TEXT NOT NULL,
        species TEXT NOT NULL DEFAULT 'poultry',
        username TEXT NOT NULL DEFAULT 'default',
        db_id TEXT NOT NULL DEFAULT 'base',
        rows_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      )`);
      userDb.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ii_library_key ON ingredient_intelligence_library(mill_id, species, username, db_id)`);
    } catch (_e) {}
    copyWhere('ingredient_intelligence_library', `LOWER(IFNULL(username,'')) = ?`, [owner]);
    try {
      userDb.prepare(`
        INSERT OR IGNORE INTO mill_formula_snapshots
        SELECT * FROM legacy.mill_formula_snapshots
        WHERE id IN (SELECT formula_snapshot_id FROM mill_batches)
      `).run();
    } catch (e) { console.warn('[MillDB] copy snapshots:', e.message); }
    try {
      userDb.prepare(`
        INSERT OR IGNORE INTO mill_batch_ingredients
        SELECT * FROM legacy.mill_batch_ingredients
        WHERE batch_id IN (SELECT id FROM mill_batches)
      `).run();
    } catch (e) { console.warn('[MillDB] copy ingredients:', e.message); }
    try {
      userDb.prepare(`
        INSERT OR IGNORE INTO mill_qc_results
        SELECT * FROM legacy.mill_qc_results
        WHERE batch_id IN (SELECT id FROM mill_batches)
      `).run();
    } catch (e) { console.warn('[MillDB] copy qc:', e.message); }

    try {
      const maps = userDb.prepare('SELECT mill_id, ingest_token FROM mill_inbound_map').all();
      for (const row of maps) {
        if (row.ingest_token) upsertInboundIndex(row.mill_id, owner, row.ingest_token);
      }
    } catch (_e) {}

    console.log(`[MillDB] Copied ${ids.length} mill(s) from shared mill.db → ${owner}`);
  } finally {
    try { userDb.exec('DETACH DATABASE legacy'); } catch (_e) {}
  }
}

function getMillDb(username) {
  const user = String(username || currentMillUser() || '').toLowerCase().trim();
  if (!user) {
    throw new Error('Mill IQ database is per-user — sign in required');
  }
  if (dbCache[user]) return dbCache[user];

  const userDir = path.join(USERS_ROOT, encodeUsername(user));
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  const dbPath = path.join(userDir, 'mill.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  initSchema(db);
  copyUserMillsFromLegacy(db, user);
  dbCache[user] = db;
  console.log('[MillDB] Connected (user):', user, dbPath);
  return db;
}

function initMillDb(username) {
  const db = getMillDb(username);
  return { ok: true, path: db.name };
}

function millDbHealth() {
  try {
    const user = currentMillUser();
    if (!user) return { ok: true, mode: 'per-user', open_users: Object.keys(dbCache) };
    const db = getMillDb(user);
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'mill_%'
      ORDER BY name
    `).all();
    return { ok: true, user, tables: tables.map(t => t.name), table_count: tables.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function closeMillDb() {
  for (const k of Object.keys(dbCache)) {
    try { dbCache[k].close(); } catch (_e) {}
    delete dbCache[k];
  }
  if (_legacyDb) { try { _legacyDb.close(); } catch (_e) {} _legacyDb = null; }
  if (_indexDb) { try { _indexDb.close(); } catch (_e) {} _indexDb = null; }
}

module.exports = {
  getMillDb,
  initMillDb,
  initSchema,
  runWithMillUser,
  currentMillUser,
  upsertInboundIndex,
  lookupInboundOwner,
  retireInboundToken,
  recordInboundPulse,
  getInboundPulse,
  getLegacySharedMillDb,
  millDbHealth,
  closeMillDb
};
