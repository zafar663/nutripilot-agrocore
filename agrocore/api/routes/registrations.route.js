// /var/www/nutripilot-agrocore/agrocore/api/routes/registrations.route.js
import express from 'express';
import Database from 'better-sqlite3';
import { join } from 'path';
import { randomUUID } from 'crypto';

const router = express.Router();

function getDb() {
  const db = new Database(join(process.cwd(), 'data', 'registrations.db'));
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
  return db;
}

// Check if registered
router.get('/v1/registrations/check/:phone', (req, res) => {
  try {
    const db = getDb();
    const phone = decodeURIComponent(req.params.phone);
    const reg = db.prepare('SELECT * FROM bot_registrations WHERE phone = ?').get(phone);
    res.json({ ok: true, registered: !!reg, registration: reg || null });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Register new user
router.post('/v1/registrations', (req, res) => {
  try {
    const db = getDb();
    const { phone, name, company, country, role, platform, metadata } = req.body;
    if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });
    const existing = db.prepare('SELECT id FROM bot_registrations WHERE phone = ?').get(phone);
    if (existing) return res.json({ ok: true, already_registered: true, id: existing.id });
    const id = randomUUID();
    db.prepare(`
      INSERT INTO bot_registrations (id, phone, name, company, country, role, platform, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, phone, name || null, company || null, country || null, role || null, platform || 'whatsapp', metadata ? JSON.stringify(metadata) : null);
    res.json({ ok: true, id, registered: true });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Update last seen + message count
router.patch('/v1/registrations/:phone/activity', (req, res) => {
  try {
    const db = getDb();
    const phone = decodeURIComponent(req.params.phone);
    db.prepare(`
      UPDATE bot_registrations 
      SET last_seen = datetime('now'), message_count = message_count + 1
      WHERE phone = ?
    `).run(phone);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Admin: get all registrations
router.get('/v1/registrations', (req, res) => {
  try {
    const db = getDb();
    const regs = db.prepare('SELECT * FROM bot_registrations ORDER BY registered_at DESC').all();
    const byCountry = {};
    regs.forEach(r => {
      const c = r.country || 'Unknown';
      byCountry[c] = (byCountry[c] || 0) + 1;
    });
    res.json({
      ok: true,
      total: regs.length,
      by_country: byCountry,
      registrations: regs,
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Admin: stats
router.get('/v1/registrations/stats', (req, res) => {
  try {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) as cnt FROM bot_registrations').get().cnt;
    const today = db.prepare("SELECT COUNT(*) as cnt FROM bot_registrations WHERE registered_at >= date('now')").get().cnt;
    const week = db.prepare("SELECT COUNT(*) as cnt FROM bot_registrations WHERE registered_at >= date('now', '-7 days')").get().cnt;
    const byCountry = db.prepare('SELECT country, COUNT(*) as cnt FROM bot_registrations GROUP BY country ORDER BY cnt DESC').all();
    const byRole = db.prepare('SELECT role, COUNT(*) as cnt FROM bot_registrations GROUP BY role ORDER BY cnt DESC').all();
    res.json({ ok: true, total, today, week, by_country: byCountry, by_role: byRole });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
