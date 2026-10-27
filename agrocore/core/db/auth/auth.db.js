import Database from 'better-sqlite3';

export const AUTH_DB_PATH = '/var/www/nutripilot-agrocore/data/users/default/nutrix.db';

export function getAuthDb() {
  const db = new Database(AUTH_DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    label TEXT,
    scopes TEXT DEFAULT '[]',
    rate_limit_per_min INTEGER DEFAULT 60,
    created_at TEXT DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked_at TEXT
  )`);
  return db;
}
