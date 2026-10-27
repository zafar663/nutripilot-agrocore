import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const { encodeUsername: encodeUserFolder } = createRequire(import.meta.url)('../../lib/normalize-email.cjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = join(__dirname, '../../../data/users');

function encodeUsername(username) {
  return encodeUserFolder(username);
}
function getUserDbPath(username) {
  const userDir = join(DATA_ROOT, encodeUsername(username));
  if (!existsSync(userDir)) mkdirSync(userDir, { recursive: true });
  return join(userDir, 'nutrix.db');
}

const dbCache = {};

function migrateSchema(db) {
  // Add model_type and model_params columns if not present (SQLite doesn't support IF NOT EXISTS for columns)
  try { db.exec(`ALTER TABLE ingredient_response_curves ADD COLUMN model_type TEXT DEFAULT 'breakpoints'`); } catch (_) {}
  try { db.exec(`ALTER TABLE ingredient_response_curves ADD COLUMN model_params TEXT DEFAULT '{}'`); } catch (_) {}
}

export function getNutrixDb(username = 'default') {
  if (dbCache[username]) return dbCache[username];
  const dbPath = getUserDbPath(username);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  migrateSchema(db);
  dbCache[username] = db;
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS formulas (
      id TEXT PRIMARY KEY,
      formula_id TEXT NOT NULL,
      formula_name TEXT NOT NULL,
      species TEXT,
      type TEXT,
      production TEXT,
      breed TEXT,
      phase TEXT,
      plant_id TEXT,
      formula_rows TEXT NOT NULL DEFAULT '[]',
      target_profile TEXT DEFAULT '[]',
      nutrient_profile TEXT DEFAULT '{}',
      cost_per_kg REAL DEFAULT 0,
      batch_size REAL DEFAULT 1000,
      batch_unit TEXT DEFAULT 'kg',
      status TEXT DEFAULT 'active',
      version INTEGER DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      month_year TEXT DEFAULT (strftime('%Y-%m', 'now'))
    );

    CREATE TABLE IF NOT EXISTS shared_formulas (
      id TEXT PRIMARY KEY,
      formula_id TEXT NOT NULL,
      shared_by TEXT NOT NULL,
      shared_with TEXT,
      permission TEXT DEFAULT 'view',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (formula_id) REFERENCES formulas(id)
    );

    CREATE TABLE IF NOT EXISTS ingredient_response_curves (
      id TEXT PRIMARY KEY,
      ingredient_id TEXT NOT NULL,
      nutrient_key TEXT NOT NULL,
      curve_name TEXT,
      breakpoints TEXT NOT NULL DEFAULT '[]',
      unit TEXT DEFAULT 'inclusion_pct',
      reference TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(ingredient_id, nutrient_key)
    );

    CREATE TABLE IF NOT EXISTS production_runs (
      id TEXT PRIMARY KEY,
      formula_id TEXT NOT NULL,
      formula_name TEXT,
      plant_id TEXT,
      batch_size_kg REAL DEFAULT 0,
      produced_at TEXT DEFAULT (datetime('now')),
      shift TEXT,
      operator TEXT,
      notes TEXT,
      FOREIGN KEY (formula_id) REFERENCES formulas(id)
    );

    CREATE TABLE IF NOT EXISTS multimix_sessions (
      id TEXT PRIMARY KEY,
      session_name TEXT,
      created_by TEXT,
      formula_ids TEXT DEFAULT '[]',
      price_date TEXT,
      status TEXT DEFAULT 'draft',
      results TEXT DEFAULT '{}',
      total_savings REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );
  `);
}