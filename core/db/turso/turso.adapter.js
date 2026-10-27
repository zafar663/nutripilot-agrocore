/**
 * NutriPilot DB Adapter
 *
 * Wraps both better-sqlite3 (local) and @libsql/client (Turso cloud) behind
 * a single async interface so routes don't need to know which backend is used.
 *
 * Usage (in routes):
 *   const db = await getUserDb(req);          // returns NpDb instance
 *   const rows = await db.all('SELECT ...');  // works for both local + Turso
 *   await db.run('INSERT INTO ...', [params]);
 *   const row = await db.get('SELECT ...');
 */

import { createClient } from '@libsql/client';
import Database        from 'better-sqlite3';
import { getNutrixDb } from '../nutrix/nutrix.db.js';
import crypto          from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getMillDb } = require('../mill/mill.db.cjs');

// ── Encryption helpers for stored Turso credentials ───────────────────────────
const ENC_KEY = process.env.TURSO_ENC_KEY || 'nutripilot-turso-key-2026-change-me';

function encrypt(text) {
  const iv  = crypto.randomBytes(16);
  const key = crypto.createHash('sha256').update(ENC_KEY).digest();
  const c   = crypto.createCipheriv('aes-256-cbc', key, iv);
  return iv.toString('hex') + ':' + Buffer.concat([c.update(text), c.final()]).toString('hex');
}

function decrypt(encoded) {
  try {
    const [ivHex, enc] = encoded.split(':');
    const key = crypto.createHash('sha256').update(ENC_KEY).digest();
    const d   = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
    return Buffer.concat([d.update(Buffer.from(enc, 'hex')), d.final()]).toString();
  } catch (_) { return null; }
}

export { encrypt, decrypt };

// ── Turso client cache (one per user) ─────────────────────────────────────────
const tursoClientCache = new Map(); // email → { client, ts }
const TURSO_TTL = 5 * 60 * 1000;   // reuse client for 5 min

export function getTursoClient(url, token) {
  const key = url + '|' + token;
  const cached = tursoClientCache.get(key);
  if (cached && (Date.now() - cached.ts) < TURSO_TTL) return cached.client;

  const client = createClient({ url, authToken: token });
  tursoClientCache.set(key, { client, ts: Date.now() });
  return client;
}

// ── NpDb: unified async interface ─────────────────────────────────────────────
export class NpDb {
  constructor(source) {
    // source = { type: 'local', db } | { type: 'turso', client }
    this.type   = source.type;
    this.db     = source.db     || null;  // better-sqlite3 instance
    this.client = source.client || null;  // libsql client
  }

  /** Run a SELECT that returns multiple rows */
  async all(sql, args = []) {
    if (this.type === 'turso') {
      const res = await this.client.execute({ sql, args });
      return res.rows.map(r => rowToObj(r, res.columns));
    }
    return this.db.prepare(sql).all(...args);
  }

  /** Run a SELECT that returns one row */
  async get(sql, args = []) {
    if (this.type === 'turso') {
      const res = await this.client.execute({ sql, args });
      if (!res.rows.length) return undefined;
      return rowToObj(res.rows[0], res.columns);
    }
    return this.db.prepare(sql).get(...args);
  }

  /** Run an INSERT/UPDATE/DELETE */
  async run(sql, args = []) {
    if (this.type === 'turso') {
      const res = await this.client.execute({ sql, args });
      return { changes: res.rowsAffected, lastInsertRowid: res.lastInsertRowid };
    }
    return this.db.prepare(sql).run(...args);
  }

  /** Run multiple statements in a batch (DDL, migrations) */
  async exec(sql) {
    if (this.type === 'turso') {
      const stmts = sql.split(';').map(s => s.trim()).filter(Boolean).map(s => ({ sql: s }));
      if (stmts.length) await this.client.batch(stmts, 'write');
      return;
    }
    this.db.exec(sql);
  }

  /** Run multiple operations in a transaction */
  async transaction(fn) {
    if (this.type === 'turso') {
      const tx = await this.client.transaction('write');
      try {
        const result = await fn({
          execute: (sql, args = []) => tx.execute({ sql, args }),
        });
        await tx.commit();
        return result;
      } catch (e) {
        await tx.rollback();
        throw e;
      }
    }
    // Local: use better-sqlite3 synchronous transaction
    return this.db.transaction(() => fn({ execute: (sql, args = []) => this.db.prepare(sql).run(...args) }))();
  }

  /** Ensure a column exists (safe migration helper) */
  async addColumnIfMissing(table, col, definition) {
    try {
      await this.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`);
    } catch (_) { /* already exists */ }
  }

  isTurso() { return this.type === 'turso'; }
}

// Convert libsql row (array-like) to plain object using column names
function rowToObj(row, columns) {
  const obj = {};
  columns.forEach((col, i) => { obj[col] = row[i] ?? row[col] ?? null; });
  return obj;
}

// ── Factory: get the right DB for this request ────────────────────────────────
/**
 * Returns an NpDb backed by the user's Turso DB (if configured) or local nutrix.db.
 * Use for all Nutrix formulation data (formulas, enzyme-curves, ingredient-intelligence, etc.)
 */
export function getUserNpDb(req) {
  if (req.tursoClient) {
    return new NpDb({ type: 'turso', client: req.tursoClient });
  }
  const user = req.nutrixUser || req.headers?.['x-nutrix-user'] || 'default';
  const localDb = getNutrixDb(user);
  return new NpDb({ type: 'local', db: localDb });
}

/**
 * Returns an NpDb backed by the user's Turso DB (if configured) or local mill.db.
 * Use for premix, user-prefs, ingredient-intelligence, and mill routes.
 */
export function getUserMillDb(req) {
  if (req.tursoClient) {
    return new NpDb({ type: 'turso', client: req.tursoClient });
  }
  const user = req.nutrixUser || req.headers?.['x-nutrix-user'];
  if (!user) throw new Error('Mill database requires a signed-in user');
  const localDb = getMillDb(String(user).toLowerCase());
  return new NpDb({ type: 'local', db: localDb });
}
