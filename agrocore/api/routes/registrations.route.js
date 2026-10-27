// /var/www/nutripilot-agrocore/agrocore/api/routes/registrations.route.js
import express from 'express';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

const router = express.Router();

const REG_DB_PATH = process.env.BOT_REG_DB
  || '/var/www/nutripilot-agrocore/data/registrations.db';

function phoneKeys(phone) {
  let raw = decodeURIComponent(String(phone || ''));
  raw = raw.replace(/ /g, '+');
  const noPrefix = raw.replace(/^whatsapp:/i, '');
  const withPrefix = noPrefix.toLowerCase().startsWith('whatsapp:') ? noPrefix : `whatsapp:${noPrefix}`;
  return [...new Set([raw, noPrefix, withPrefix].filter(Boolean))];
}

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

function thisMonthUtc() {
  return new Date().toISOString().slice(0, 7);
}

function getDb() {
  const dir = dirname(REG_DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(REG_DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_registrations (
      id TEXT PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      name TEXT,
      company TEXT,
      country TEXT,
      role TEXT,
      platform TEXT DEFAULT 'whatsapp',
      status TEXT DEFAULT 'active',
      registered_at TEXT DEFAULT (datetime('now')),
      last_seen TEXT,
      message_count INTEGER DEFAULT 0,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_phone ON bot_registrations(phone);
    CREATE INDEX IF NOT EXISTS idx_country ON bot_registrations(country);
    CREATE INDEX IF NOT EXISTS idx_registered_at ON bot_registrations(registered_at);
  `);
  const cols = new Set(db.prepare('PRAGMA table_info(bot_registrations)').all().map((c) => c.name));
  const add = (name, ddl) => {
    if (!cols.has(name)) db.exec(`ALTER TABLE bot_registrations ADD COLUMN ${ddl}`);
  };
  add('daily_msg_count', 'daily_msg_count INTEGER DEFAULT 0');
  add('daily_msg_date', 'daily_msg_date TEXT');
  add('monthly_msg_count', 'monthly_msg_count INTEGER DEFAULT 0');
  add('monthly_msg_month', 'monthly_msg_month TEXT');
  add('monthly_deepfix_count', 'monthly_deepfix_count INTEGER DEFAULT 0');
  add('monthly_deepfix_month', 'monthly_deepfix_month TEXT');
  add('paid_deepfix_credits', 'paid_deepfix_credits INTEGER DEFAULT 0');
  add('subscription_status', 'subscription_status TEXT');
  add('deepfix_count', 'deepfix_count INTEGER DEFAULT 0');
  return db;
}

function withDb(fn) {
  const db = getDb();
  try {
    return fn(db);
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

function findReg(db, phone) {
  const keys = phoneKeys(phone);
  const placeholders = keys.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM bot_registrations WHERE phone IN (${placeholders})`).get(...keys) || null;
}

function bumpMessageActivity(db, phone) {
  const row = findReg(db, phone);
  if (!row) return { ok: true, updated: 0 };
  const today = todayUtcDate();
  const month = thisMonthUtc();
  const daily = row.daily_msg_date === today ? (row.daily_msg_count || 0) + 1 : 1;
  const monthly = row.monthly_msg_month === month ? (row.monthly_msg_count || 0) + 1 : 1;
  db.prepare(`
    UPDATE bot_registrations
    SET last_seen = datetime('now'),
        message_count = COALESCE(message_count, 0) + 1,
        daily_msg_count = ?,
        daily_msg_date = ?,
        monthly_msg_count = ?,
        monthly_msg_month = ?
    WHERE phone = ?
  `).run(daily, today, monthly, month, row.phone);
  return {
    ok: true,
    updated: 1,
    message_count: (row.message_count || 0) + 1,
    daily_msg_count: daily,
    monthly_msg_count: monthly,
    subscription_status: row.subscription_status || 'free',
  };
}

// Check if registered
router.get('/v1/registrations/check/:phone', (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const registration = withDb((db) => findReg(db, phone));
    res.json({ ok: true, registered: !!registration, registration: registration || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Register new user
router.post('/v1/registrations', (req, res) => {
  try {
    const { phone, name, company, country, role, platform, metadata } = req.body;
    if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });
    const out = withDb((db) => {
      const existing = findReg(db, phone);
      if (existing) return { ok: true, already_registered: true, id: existing.id };
      const id = randomUUID();
      const storedPhone = phoneKeys(phone)[0];
      db.prepare(`
        INSERT INTO bot_registrations (id, phone, name, company, country, role, platform, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, storedPhone, name || null, company || null, country || null, role || null, platform || 'whatsapp', metadata ? JSON.stringify(metadata) : null);
      return { ok: true, id, registered: true };
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Update last seen + message count (WhatsApp FeedBot → Super Admin)
router.patch('/v1/registrations/:phone/activity', (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const out = withDb((db) => bumpMessageActivity(db, phone));
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Called by FeedBot for quota + the same Super Admin counters
router.post('/v1/registrations/:phone/usage/message', (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const out = withDb((db) => {
      const bumped = bumpMessageActivity(db, phone);
      return { ...bumped, allowed: true, limit: 3 };
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/v1/registrations/:phone/usage/deepfix', (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const out = withDb((db) => {
      const row = findReg(db, phone);
      if (!row) return { ok: true, allowed: true, nutrix_lite: false, updated: 0 };
      const month = thisMonthUtc();
      const monthly = row.monthly_deepfix_month === month ? (row.monthly_deepfix_count || 0) + 1 : 1;
      db.prepare(`
        UPDATE bot_registrations
        SET last_seen = datetime('now'),
            deepfix_count = COALESCE(deepfix_count, 0) + 1,
            monthly_deepfix_count = ?,
            monthly_deepfix_month = ?
        WHERE phone = ?
      `).run(monthly, month, row.phone);
      return { ok: true, allowed: true, nutrix_lite: false, updated: 1, monthly_deepfix_count: monthly };
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Admin: get all registrations
router.get('/v1/registrations', (req, res) => {
  try {
    const out = withDb((db) => {
      const regs = db.prepare('SELECT * FROM bot_registrations ORDER BY registered_at DESC').all();
      const byCountry = {};
      regs.forEach((r) => {
        const c = r.country || 'Unknown';
        byCountry[c] = (byCountry[c] || 0) + 1;
      });
      return { ok: true, total: regs.length, by_country: byCountry, registrations: regs };
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Admin: stats
router.get('/v1/registrations/stats', (req, res) => {
  try {
    const out = withDb((db) => {
      const total = db.prepare('SELECT COUNT(*) as cnt FROM bot_registrations').get().cnt;
      const today = db.prepare("SELECT COUNT(*) as cnt FROM bot_registrations WHERE registered_at >= date('now')").get().cnt;
      const week = db.prepare("SELECT COUNT(*) as cnt FROM bot_registrations WHERE registered_at >= date('now', '-7 days')").get().cnt;
      const by_country = db.prepare('SELECT country, COUNT(*) as cnt FROM bot_registrations GROUP BY country ORDER BY cnt DESC').all();
      const by_role = db.prepare('SELECT role, COUNT(*) as cnt FROM bot_registrations GROUP BY role ORDER BY cnt DESC').all();
      return { ok: true, total, today, week, by_country, by_role };
    });
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
