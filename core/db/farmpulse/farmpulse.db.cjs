'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { currentWorkspaceUser } = require('../workspace-context.cjs');
const { encodeUsername: encodeUserFolder } = require('../../lib/normalize-email.cjs');

const DATA_ROOT = path.join(__dirname, '..', '..', '..', 'data');
const USERS_ROOT = path.join(DATA_ROOT, 'users');
const LEGACY_PATH = path.join(DATA_ROOT, 'farmpulse.db');
const SCHEMA_PATH = path.join(__dirname, 'farmpulse.schema.sql');
const { ensureFarmPulseSchemaSync } = require('./ensure-farmpulse-schema.cjs');

const dbCache = Object.create(null);

function encodeUsername(username) {
  return encodeUserFolder(username);
}

function initSchema(db) {
  if (fs.existsSync(SCHEMA_PATH)) {
    try { db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8')); } catch (e) {
      console.error('[FarmPulseDB] schema.sql apply failed:', e?.message || e);
    }
  }
  ensureFarmPulseSchemaSync(db);
}

function getFarmPulseDb(username) {
  const user = String(username || currentWorkspaceUser() || '').toLowerCase().trim();
  if (!user) throw new Error('Farm Pulse database is per-user — sign in required');
  if (dbCache[user]) return dbCache[user];
  const userDir = path.join(USERS_ROOT, encodeUsername(user));
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  const dbPath = path.join(userDir, 'farmpulse.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  initSchema(db);
  dbCache[user] = db;
  console.log('[FarmPulseDB] Connected (user):', user, dbPath);
  return db;
}

function migrateLegacyShared() {
  if (!fs.existsSync(LEGACY_PATH)) return;
  try {
    const db = new Database(LEGACY_PATH);
    ensureFarmPulseSchemaSync(db);
    db.close();
    console.log('[FarmPulseDB] Legacy shared farmpulse.db columns ensured');
  } catch (e) {
    console.error('[FarmPulseDB] Legacy shared migrate failed:', e?.message || e);
  }
}

function initFarmPulseDb() {
  migrateLegacyShared();
  console.log('[FarmPulseDB] Per-user farmpulse.db opens on first Farm Pulse request');
  return { ok: true, deferred: true };
}

module.exports = { getFarmPulseDb, initFarmPulseDb };
