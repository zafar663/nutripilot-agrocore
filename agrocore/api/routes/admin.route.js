// ============================================================
// NutriPilot — Master Admin Portal Routes v3
// Full executive dashboard with all modules enhanced
// ============================================================
import express from 'express';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { sendMail } from '../../core/email/mailer.js';
import { invalidateUserStatus } from '../middleware/auth-gate.mw.js';
import jwt from 'jsonwebtoken';
import { evaluateAddUser, occupancyFromRoster, parseExtraSeats, billedModules, extraSeatMonthly, normalizePlan } from '../lib/seats.js';
import { isOwnerEmail } from '../lib/billing-grant.js';

const require      = createRequire(import.meta.url);
const __dirname    = dirname(fileURLToPath(import.meta.url));
const Database     = require('better-sqlite3');
const { randomUUID, randomBytes, createHash } = require('crypto');
const bcrypt       = require('bcryptjs');

const router = express.Router();

function getMillDb() {
  return new Database(require('path').join(process.cwd(), 'data', 'mill.db'));
}
function getFarmDb() {
  return new Database(require('path').join(process.cwd(), 'data', 'farmpulse.db'));
}

const ok  = (res, data)            => res.json({ ok: true, data });
const err = (res, e, status = 500) => res.status(status).json({ ok: false, error: e.message || String(e) });

function ensureAdminTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer', status TEXT NOT NULL DEFAULT 'active',
      modules TEXT DEFAULT '[]', last_login TEXT, created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS admin_activity_log (
      id TEXT PRIMARY KEY, user_id TEXT, user_email TEXT, action TEXT NOT NULL,
      module TEXT, details TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
    CREATE INDEX IF NOT EXISTS idx_admin_activity_time ON admin_activity_log(created_at);
  `);
  // Additive column migrations — safe to run on every startup
  const addCol = (tbl, col, def) => {
    try { db.prepare(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`).run(); } catch {}
  };
  addCol('admin_users',        'owner_email',     'TEXT');
  addCol('admin_users',        'created_ip',      'TEXT');
  addCol('admin_users',        'created_by_jwt',  'TEXT');
  addCol('admin_users',        'updated_at',      "TEXT DEFAULT (datetime('now'))");
  addCol('admin_activity_log', 'ip',              'TEXT');
}

function seedDefaultAdmin(db) {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM admin_users').get().cnt;
  if (count > 0) return;
  const now = new Date().toISOString();
  const allMods = JSON.stringify(['nutrix','milliq','vendorpulse','farmpulse','liveiq','admin']);
  const samples = [
    { name:'System Administrator',  email:'admin@nutripilot.com',        role:'admin',        mods: allMods },
    { name:'Feed Nutritionist',      email:'nutritionist@nutripilot.com', role:'nutritionist', mods: JSON.stringify(['nutrix','vendorpulse']) },
    { name:'Procurement Manager',    email:'purchaser@nutripilot.com',    role:'purchaser',    mods: JSON.stringify(['vendorpulse']) },
    { name:'Mill Manager',           email:'mill@nutripilot.com',         role:'mill_manager', mods: JSON.stringify(['milliq']) },
    { name:'Farm Manager',           email:'farm@nutripilot.com',         role:'farm_manager', mods: JSON.stringify(['farmpulse']) },
    { name:'Lab Technician',         email:'lab@nutripilot.com',          role:'lab',          mods: JSON.stringify(['nutrix','milliq']) },
  ];
  for (const u of samples) {
    db.prepare(`INSERT INTO admin_users (id,name,email,role,status,modules,created_by,created_at,updated_at) VALUES (?,?,?,?,'active',?,'system',?,?)`)
      .run(randomUUID(), u.name, u.email, u.role, u.mods, now, now);
  }
}

function safeGet(db, sql, p=[]) { try { return db.prepare(sql).get(...p); } catch { return null; } }
function safeAll(db, sql, p=[]) { try { return db.prepare(sql).all(...p); } catch { return []; } }

const JWT_SECRET = process.env.JWT_SECRET || (() => { throw new Error('[admin] JWT_SECRET env var is required'); })();

// Decode the Bearer JWT and return the caller's email — never trust req.body for identity
function ownerEmailOf(req) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return null;
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.email || null;
  } catch { return null; }
}

// Resolve the true enterprise owner for a request.
// A caller can be: (a) the enterprise owner themselves, (b) a sub-admin in admin_users,
// or (c) a provisioned np_users account. Walk both tables to find the root owner.
// Returns { callerEmail, enterpriseOwner }.
function resolveOwner(req) {
  const callerEmail = ownerEmailOf(req);
  if (!callerEmail) return { callerEmail: null, enterpriseOwner: null };
  try {
    // Check admin_users first — sub-admins created via admin portal live here
    const db = getMillDb();
    ensureAdminTables(db); ensureOwnerEmailColumn(db);
    const adminRow = db.prepare(`SELECT owner_email FROM admin_users WHERE LOWER(email)=LOWER(?) LIMIT 1`).get(callerEmail);
    db.close();
    if (adminRow && adminRow.owner_email) return { callerEmail, enterpriseOwner: adminRow.owner_email };

    // Check np_users — provisioned sub-users have a provisioned_by pointing to their enterprise owner
    try {
      const adb = getAuthDb();
      const npRow = adb.prepare(`SELECT provisioned_by FROM np_users WHERE LOWER(email)=LOWER(?) LIMIT 1`).get(callerEmail);
      adb.close();
      if (npRow && npRow.provisioned_by) return { callerEmail, enterpriseOwner: npRow.provisioned_by };
    } catch {}

    // Caller is not a sub-user — they are the enterprise owner themselves
    return { callerEmail, enterpriseOwner: callerEmail };
  } catch {
    return { callerEmail, enterpriseOwner: callerEmail };
  }
}

// Add owner_email column if not present (runs once, safe to repeat)
function ensureOwnerEmailColumn(db) {
  const cols = db.prepare("PRAGMA table_info(admin_users)").all();
  if (!cols.find(c => c.name === 'owner_email'))    db.prepare("ALTER TABLE admin_users ADD COLUMN owner_email TEXT").run();
  if (!cols.find(c => c.name === 'created_ip'))     db.prepare("ALTER TABLE admin_users ADD COLUMN created_ip TEXT").run();
  if (!cols.find(c => c.name === 'created_by_jwt')) db.prepare("ALTER TABLE admin_users ADD COLUMN created_by_jwt TEXT").run();
}

function clientIp(req) {
  return (req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '').trim();
}

// ════════════════════════════════════════════════════════════════
// EXECUTIVE DASHBOARD
// ════════════════════════════════════════════════════════════════
router.get('/dashboard', (req, res) => {
  try {
    const db = getMillDb(); const fdb = getFarmDb();
    ensureAdminTables(db); seedDefaultAdmin(db);

    // VendorPulse
    const vp_pending    = safeGet(db,`SELECT COUNT(*) as c FROM ingredient_prices WHERE status='pending_review'`)?.c||0;
    const vp_approved   = safeGet(db,`SELECT COUNT(*) as c FROM ingredient_prices WHERE status='approved'`)?.c||0;
    const vp_rejected   = safeGet(db,`SELECT COUNT(*) as c FROM ingredient_prices WHERE status='rejected'`)?.c||0;
    const vp_total      = safeGet(db,`SELECT COUNT(*) as c FROM ingredient_prices`)?.c||0;
    const vp_open_pos   = safeGet(db,`SELECT COUNT(*) as c FROM purchase_orders WHERE status IN ('draft','submitted','approved')`)?.c||0;
    const vp_po_value   = safeGet(db,`SELECT COALESCE(SUM(total_usd),0) as t FROM purchase_orders WHERE status!='rejected'`)?.t||0;
    const vp_suppliers  = safeGet(db,`SELECT COUNT(*) as c FROM purchaser_suppliers WHERE status='active'`)?.c||0;
    const vp_rate       = vp_total>0 ? Math.round((vp_approved/vp_total)*100) : 0;
    const top_ingr      = safeAll(db,`SELECT ingredient_name, ROUND(AVG(price_per_unit*exchange_rate),2) as avg_usd FROM ingredient_prices WHERE status='approved' GROUP BY ingredient_name ORDER BY avg_usd DESC LIMIT 5`);
    const currency_exp  = safeAll(db,`SELECT currency, COUNT(*) as cnt, ROUND(SUM(price_per_unit*exchange_rate),2) as total_usd FROM ingredient_prices WHERE status='approved' GROUP BY currency ORDER BY total_usd DESC`);
    const price_trend   = safeAll(db,`SELECT strftime('%Y-%m',created_at) as month, COUNT(*) as submissions, ROUND(AVG(price_per_unit*exchange_rate),2) as avg_usd FROM ingredient_prices GROUP BY month ORDER BY month DESC LIMIT 6`).reverse();
    const expiring      = safeAll(db,`SELECT contract_name, supplier_name, expiry_date, CAST((julianday(expiry_date)-julianday('now')) AS INTEGER) as days_remaining FROM supplier_contracts WHERE julianday(expiry_date)-julianday('now') < 60 ORDER BY days_remaining ASC LIMIT 5`);

    // MillIQ
    const mill_active   = safeGet(db,`SELECT COUNT(*) as c FROM mill_batches WHERE status IN ('pending','confirmed','in_progress')`)?.c||0;
    const mill_done     = safeGet(db,`SELECT COUNT(*) as c FROM mill_batches WHERE status='completed'`)?.c||0;
    const mill_tons     = safeGet(db,`SELECT COALESCE(SUM(actual_qty_tons),0) as t FROM mill_batches WHERE status='completed'`)?.t||0;
    const qc_pass       = safeGet(db,`SELECT COUNT(*) as c FROM mill_qc_results WHERE overall_status='pass'`)?.c||0;
    const qc_total      = safeGet(db,`SELECT COUNT(*) as c FROM mill_qc_results WHERE overall_status!='pending'`)?.c||0;
    const qc_rate       = qc_total>0 ? Math.round((qc_pass/qc_total)*100) : 0;
    const downtime_hrs  = safeGet(db,`SELECT COALESCE(SUM(duration_minutes)/60.0,0) as h FROM mill_downtime_events WHERE started_at>=date('now','-7 days')`)?.h||0;
    const batch_trend   = safeAll(db,`SELECT strftime('%Y-%m',created_at) as month, COUNT(*) as batches, ROUND(COALESCE(SUM(planned_qty_tons),0),1) as planned_tons, ROUND(COALESCE(SUM(actual_qty_tons),0),1) as actual_tons FROM mill_batches GROUP BY month ORDER BY month DESC LIMIT 6`).reverse();
    const qc_breakdown  = safeAll(db,`SELECT overall_status, COUNT(*) as cnt FROM mill_qc_results GROUP BY overall_status`);
    const downtime_by_machine = safeAll(db,`SELECT machine, SUM(duration_minutes) as total_mins, COUNT(*) as events FROM mill_downtime_events GROUP BY machine ORDER BY total_mins DESC LIMIT 5`);

    // FarmPulse
    const fp_farms      = safeGet(fdb,`SELECT COUNT(*) as c FROM farms WHERE status='active'`)?.c||0;
    const fp_flocks     = safeGet(fdb,`SELECT COUNT(*) as c FROM flocks WHERE status='active'`)?.c||0;
    const fp_birds      = safeGet(fdb,`SELECT COALESCE(SUM(initial_count),0) as t FROM flocks WHERE status='active'`)?.t||0;
    const fp_alerts     = safeGet(fdb,`SELECT COUNT(*) as c FROM alerts WHERE status='active'`)?.c||0;
    const avg_fcr       = safeGet(fdb,`SELECT ROUND(AVG(fcr),3) as avg FROM daily_records WHERE fcr IS NOT NULL AND fcr>0`)?.avg||0;
    const avg_mort      = safeGet(fdb,`SELECT ROUND(AVG(mortality_rate_pct),3) as avg FROM daily_records WHERE mortality_rate_pct IS NOT NULL`)?.avg||0;
    const total_feed    = safeGet(fdb,`SELECT ROUND(COALESCE(SUM(feed_intake_kg),0),0) as t FROM daily_records`)?.t||0;
    const fcr_trend     = safeAll(fdb,`SELECT record_date, ROUND(AVG(fcr),3) as avg_fcr, ROUND(AVG(avg_body_weight_g),0) as avg_bw, ROUND(AVG(mortality_rate_pct),3) as avg_mort FROM daily_records WHERE fcr IS NOT NULL GROUP BY record_date ORDER BY record_date ASC LIMIT 10`);
    const farm_perf     = safeAll(fdb,`SELECT f.name as farm_name, f.species, f.capacity, COUNT(DISTINCT fl.id) as flock_count, ROUND(AVG(dr.fcr),3) as avg_fcr, ROUND(AVG(dr.avg_body_weight_g),0) as avg_bw, ROUND(AVG(dr.mortality_rate_pct),3) as avg_mortality, MAX(dr.record_date) as last_record FROM farms f LEFT JOIN flocks fl ON fl.farm_id=f.id LEFT JOIN daily_records dr ON dr.flock_id=fl.id WHERE f.status='active' GROUP BY f.id ORDER BY f.name`);

    // NutriX
    const nutrix_ingr   = safeGet(db,`SELECT COUNT(DISTINCT ingredient_name) as c FROM ingredient_prices`)?.c||0;
    const nutrix_appr   = safeGet(db,`SELECT COUNT(DISTINCT ingredient_name) as c FROM ingredient_prices WHERE status='approved'`)?.c||0;

    // Admin
    const total_users   = safeGet(db,`SELECT COUNT(*) as c FROM admin_users`)?.c||0;
    const active_users  = safeGet(db,`SELECT COUNT(*) as c FROM admin_users WHERE status='active'`)?.c||0;
    const users_by_role = safeAll(db,`SELECT role, COUNT(*) as cnt FROM admin_users GROUP BY role`);

    // Activity
    const notifs        = safeAll(db,`SELECT type, title, message, created_at FROM purchaser_notifications ORDER BY created_at DESC LIMIT 8`);
    const batches_act   = safeAll(db,`SELECT batch_number, status, planned_qty_tons, created_at FROM mill_batches ORDER BY created_at DESC LIMIT 4`);
    const farm_alerts_act = safeAll(fdb,`SELECT alert_type, message, severity, created_at FROM alerts ORDER BY created_at DESC LIMIT 4`);

    const alerts = [
      ...(vp_pending>10 ? [{type:'warning',module:'vendorpulse',message:`${vp_pending} price submissions awaiting nutritionist approval`}] : []),
      ...(vp_open_pos>5 ? [{type:'info',module:'vendorpulse',message:`${vp_open_pos} purchase orders currently open`}] : []),
      ...(qc_rate<80&&qc_total>0 ? [{type:'warning',module:'milliq',message:`QC pass rate is ${qc_rate}% — below 80% threshold`}] : []),
      ...(fp_alerts>0 ? [{type:'warning',module:'farmpulse',message:`${fp_alerts} active farm alerts require attention`}] : []),
      ...expiring.filter(c=>c.days_remaining<30).map(c=>({type:'danger',module:'vendorpulse',message:`Contract expiring: ${c.contract_name} — ${c.days_remaining}d`})),
    ];

    const recent_activity = [
      ...notifs.map(n=>({module:'vendorpulse',type:n.type,title:n.title,message:n.message,time:n.created_at,icon:n.type==='approval'?'✓':n.type==='rejection'?'✗':'⊞'})),
      ...batches_act.map(b=>({module:'milliq',type:'batch',title:`Batch ${b.batch_number||'—'}`,message:`${b.planned_qty_tons}t — ${b.status}`,time:b.created_at,icon:'🏭'})),
      ...farm_alerts_act.map(a=>({module:'farmpulse',type:a.alert_type||'alert',title:'Farm Alert',message:a.message||'',time:a.created_at,icon:'◉'})),
    ].sort((a,b)=>(b.time||'').localeCompare(a.time||'')).slice(0,12);

    db.close(); fdb.close();

    ok(res, {
      platform: {
        nutrix:      {status:'active',label:'NutriX',description:'Feed Formulation'},
        milliq:      {status:mill_active>0?'active':'idle',label:'MillIQ',description:'Mill Operations'},
        vendorpulse: {status:'active',label:'VendorPulse',description:'Procurement'},
        farmpulse:   {status:'active',label:'FarmPulse',description:'Farm Intelligence'},
        liveiq:      {status:'active',label:'LiveIQ',description:'WhatsApp Bot'},
      },
      vendorpulse: { pending_approvals:vp_pending, approved_prices:vp_approved, rejected_prices:vp_rejected,
        open_pos:vp_open_pos, po_total_value:Math.round(vp_po_value), active_suppliers:vp_suppliers,
        total_submissions:vp_total, approval_rate:vp_rate, top_ingredients:top_ingr,
        currency_exposure:currency_exp, price_trend, expiring_contracts:expiring },
      milliq: { active_batches:mill_active, completed_batches:mill_done, total_tons:Math.round(mill_tons*10)/10,
        qc_rate, qc_pass, qc_total, downtime_hrs:Math.round(downtime_hrs*10)/10,
        batch_trend, qc_breakdown, downtime_by_machine },
      farmpulse: { active_farms:fp_farms, active_flocks:fp_flocks, total_birds:fp_birds,
        farm_alerts:fp_alerts, avg_fcr, avg_mortality:avg_mort, total_feed_consumed:total_feed,
        fcr_trend, farm_performance:farm_perf },
      nutrix: { unique_ingredients:nutrix_ingr, ingredients_with_approved:nutrix_appr },
      admin: { total_users, active_users, users_by_role },
      alerts, recent_activity,
    });
  } catch(e) { err(res,e); }
});

// ════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ════════════════════════════════════════════════════════════════
function loadSeatContext(enterpriseOwner) {
  const adb = getAuthDb();
  let owner = null;
  try {
    owner = adb.prepare(`SELECT email, plan_granted, plan_interest, modules_granted, country, country_tier, extra_seats
      FROM np_users WHERE LOWER(email)=LOWER(?) LIMIT 1`).get(enterpriseOwner);
  } catch { owner = null; }
  finally { adb.close(); }
  const mill = getMillDb();
  ensureAdminTables(mill); ensureOwnerEmailColumn(mill);
  const subs = mill.prepare(`SELECT email, status, modules FROM admin_users WHERE LOWER(owner_email)=LOWER(?)`).all(enterpriseOwner);
  mill.close();
  let ownerModules = [];
  try { ownerModules = JSON.parse(owner?.modules_granted || "[]") || []; } catch { ownerModules = []; }
  const occupancy = occupancyFromRoster({ ownerModules, subs });
  const accountUsed = 1 + subs.filter((s) => String(s.status || "active").toLowerCase() === "active").length;
  const plan = owner?.plan_granted || owner?.plan_interest || "starter";
  const tier = Number(owner?.country_tier) || 1;
  return {
    plan,
    tier,
    country: owner?.country || "",
    occupancy,
    extraSeats: parseExtraSeats(owner?.extra_seats),
    accountUsed,
    ownerModules: billedModules(ownerModules),
    unlimited: isOwnerEmail(enterpriseOwner) || normalizePlan(plan) === "unlimited",
  };
}

router.get('/seats', (req, res) => {
  try {
    const { callerEmail, enterpriseOwner } = resolveOwner(req);
    if (!callerEmail) return err(res, new Error('Unauthorized'), 401);
    const ctx = loadSeatContext(enterpriseOwner);
    const extraPrices = {};
    for (const m of ["nutrix", "milliq", "farmpulse", "vendorpulse", "lab-quality"]) {
      extraPrices[m] = extraSeatMonthly(m, ctx.tier);
    }
    extraPrices.labportal = extraPrices["lab-quality"];
    ok(res, { ...ctx, extraPrices, email: enterpriseOwner });
  } catch (e) { err(res, e); }
});

router.get('/users', (req, res) => {
  try {
    const { callerEmail, enterpriseOwner } = resolveOwner(req);
    if (!callerEmail) return err(res, new Error('Unauthorized'), 401);
    const db = getMillDb(); ensureAdminTables(db); ensureOwnerEmailColumn(db);
    const users = db.prepare(`SELECT * FROM admin_users WHERE owner_email=? ORDER BY created_at DESC`).all(enterpriseOwner);
    db.close();
    ok(res, users.map(u=>({...u, modules: u.modules ? JSON.parse(u.modules) : []})));
  } catch(e) { err(res,e); }
});

const MODULE_URLS = {
  nutrix:       { label: 'NutriX — Nutrition & Formulation', path: '/formulation-workspace' },
  milliq:       { label: 'MillIQ — Feed Mill Operations',    path: '/feed-mill-operations'  },
  vendorpulse:  { label: 'VendorPulse — Procurement',        path: '/purchaser-portal'       },
  farmpulse:    { label: 'FarmPulse — Farm Intelligence',    path: '/farm-pulse'             },
  nutrixlite:   { label: 'Nutrix Lite — Guest optimizer',    path: '/nutrix-lite-portal'     },
  liveiq:       { label: 'LiveIQ — Live Production',         path: '/farm-pulse'             },
  'lab-quality':{ label: 'Lab & Quality',                    path: '/quality-control'        },
  admin:        { label: 'Admin Portal',                     path: '/admin-portal'           },
};
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://agrocoreprime.com';
function _encAdmin(e) { return String(e).replace(/@/g,'_at_').replace(/\./g,'_dot_'); }
const AUTH_DB_PATH = `/var/www/nutripilot-agrocore/data/users/${_encAdmin(process.env.SUPER_ADMIN_EMAIL||'feednutritionmillconsulting@gmail.com')}/nutrix.db`;
const SETUP_TTL_HOURS = 72;

function getAuthDb() {
  const db = new Database(AUTH_DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS np_users (
    id TEXT PRIMARY KEY, full_name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, company_name TEXT, role TEXT,
    status TEXT DEFAULT 'pending', modules_granted TEXT DEFAULT '[]',
    plan_granted TEXT, created_at TEXT DEFAULT (datetime('now')),
    approved_at TEXT, notes TEXT
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL,
    used_at TEXT, created_at TEXT DEFAULT (datetime('now'))
  );`);
  // Migration: provisioned_by marks sub-users created via admin portal (not self-registered)
  try { db.exec(`ALTER TABLE np_users ADD COLUMN provisioned_by TEXT`); } catch {}
  try { db.exec(`ALTER TABLE np_users ADD COLUMN extra_seats TEXT`); } catch {}
  return db;
}

function npStatusFromAdmin(status) {
  return (status === 'inactive' || status === 'suspended') ? 'suspended' : 'approved';
}

/** Keep the login JWT record in sync with Admin Portal edits (modules, role, name, status). */
function syncLoginAccount({ email, name, role, modules, status, ownerEmail }) {
  if (!email || !ownerEmail) return;
  const adb = getAuthDb();
  try {
    const row = adb.prepare(
      `SELECT id, provisioned_by FROM np_users WHERE LOWER(email)=LOWER(?) LIMIT 1`
    ).get(email);
    if (!row) return;
    const existingOwner = (row.provisioned_by || '').toLowerCase();
    const owner = String(ownerEmail).toLowerCase();
    if (existingOwner && existingOwner !== owner) return;
    const now = new Date().toISOString();
    const npStatus = npStatusFromAdmin(status);
    adb.prepare(`
      UPDATE np_users SET
        full_name=COALESCE(?, full_name),
        role=COALESCE(?, role),
        modules_granted=?,
        status=?,
        provisioned_by=COALESCE(NULLIF(provisioned_by,''), ?),
        approved_at=CASE WHEN ?='approved' THEN COALESCE(approved_at, ?) ELSE approved_at END,
        updated_at=?
      WHERE id=?
    `).run(
      name || null,
      role || null,
      JSON.stringify(modules || []),
      npStatus,
      ownerEmail,
      npStatus,
      now,
      now,
      row.id
    );
    try { invalidateUserStatus(row.id); } catch (_) {}
  } finally {
    adb.close();
  }
}

/** Create/update the login account in np_users and return a one-time setup token URL. */
async function provisionLoginAccount(name, email, role, modules, ownerEmail) {
  const adb = getAuthDb();
  const now = new Date().toISOString();
  const existing = adb.prepare('SELECT id, provisioned_by, full_name FROM np_users WHERE email = ?').get(email.toLowerCase());

  let userId;
  if (existing) {
    // Guard: never overwrite an account that belongs to a different owner or has no provisioned_by
    // (self-registered accounts, other enterprises' sub-users, system admins).
    const existingOwner = (existing.provisioned_by || '').toLowerCase();
    const callerOwner   = (ownerEmail || '').toLowerCase();
    if (existingOwner && existingOwner !== callerOwner) {
      adb.close();
      throw new Error(`Account ${email} is managed by a different owner and cannot be re-provisioned.`);
    }
    if (!existingOwner) {
      // Self-registered account: only update provisioned_by and grant new modules, never downgrade role
      adb.prepare(`UPDATE np_users SET provisioned_by=COALESCE(NULLIF(provisioned_by,''),?), updated_at=? WHERE id=?`)
        .run(ownerEmail || null, now, existing.id);
    } else {
      // Own sub-user: safe to update fully
      adb.prepare(`UPDATE np_users SET full_name=?, role=?, modules_granted=?, status='approved', approved_at=?, updated_at=? WHERE id=?`)
        .run(name, role || 'viewer', JSON.stringify(modules || []), now, now, existing.id);
    }
    userId = existing.id;
  } else {
    // Create account with a random unusable password — they must set it via the setup link
    userId = 'u_' + randomUUID();
    const dummyHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    adb.prepare(`INSERT INTO np_users (id,full_name,email,password_hash,role,status,modules_granted,approved_at,created_at,provisioned_by) VALUES (?,?,?,?,?,'approved',?,?,?,?)`)
      .run(userId, name, email.toLowerCase(), dummyHash, role || 'viewer', JSON.stringify(modules || []), now, now, ownerEmail || null);
  }

  // Invalidate any existing unused reset tokens for this user
  adb.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL`).run(userId);

  // Generate a 72-hour setup token
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + SETUP_TTL_HOURS * 3600000).toISOString();
    adb.prepare(`INSERT INTO password_resets (id, user_id, email, token_hash, expires_at) VALUES (?,?,?,?,?)`)
    .run('pr_' + Date.now(), userId, email.toLowerCase(), tokenHash, expiresAt);
  try { invalidateUserStatus(userId); } catch (_) {}
  adb.close();

  return `${APP_BASE_URL}/reset-password?token=${rawToken}`;
}

function buildWelcomeEmail(name, email, grantedModules, setupLink) {
  const defs = (grantedModules || []).map(m => MODULE_URLS[m]).filter(Boolean);

  const textLines = defs.length
    ? defs.map(d => `  • ${d.label}: ${APP_BASE_URL}${d.path}`).join('\n')
    : '  (no modules assigned — contact your administrator)';

  const htmlItems = defs.length
    ? defs.map(d => `<li><strong>${d.label}</strong>: <a href="${APP_BASE_URL}${d.path}">${APP_BASE_URL}${d.path}</a></li>`).join('')
    : '<li style="color:#888">No modules assigned — contact your administrator.</li>';

  const text = `Hello ${name},

Your AgroCore Prime account has been created and is ready to use.

━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — Set up your password (link expires in 72 hours):
${setupLink}
━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 2 — After setting your password, log in at:
${APP_BASE_URL}

Your module access:
${textLines}

You will only be able to access the modules listed above.

Welcome to AgroCore Prime!`;

  const html = `<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#1a3a2a;">
  <div style="background:#173B2B;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:18px;">Welcome to AgroCore Prime</h2>
  </div>
  <div style="background:#f8fdf9;border:1px solid #d4e8db;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
    <p>Hello <strong>${name}</strong>,</p>
    <p>Your account has been created. Complete these two steps to get started:</p>

    <div style="background:#eaf7ef;border:1px solid #b2dfc2;border-radius:8px;padding:16px 20px;margin:16px 0;">
      <p style="margin:0 0 8px;font-weight:700;font-size:14px;">Step 1 — Set up your password</p>
      <p style="margin:0 0 12px;font-size:13px;color:#555;">This link expires in 72 hours.</p>
      <a href="${setupLink}" style="display:inline-block;background:#2f9e54;color:#fff;padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">Set Up My Password →</a>
    </div>

    <div style="background:#f0f9f4;border:1px solid #d4e8db;border-radius:8px;padding:16px 20px;margin:16px 0;">
      <p style="margin:0 0 8px;font-weight:700;font-size:14px;">Step 2 — Log in at</p>
      <a href="${APP_BASE_URL}" style="color:#2f9e54;font-weight:600;">${APP_BASE_URL}</a>
    </div>

    <p style="margin-top:20px;"><strong>Your module access:</strong></p>
    <ul style="margin:8px 0;padding-left:20px;line-height:2;">${htmlItems}</ul>
    <hr style="border:none;border-top:1px solid #d4e8db;margin:20px 0;" />
    <p style="font-size:12px;color:#666;">Log in with your email <strong>${email}</strong> after setting your password. Only the modules listed above are accessible to your account.</p>
  </div>
</div>`;

  return { text, html };
}

router.post('/users', async (req, res) => {
  try {
    const { callerEmail, enterpriseOwner } = resolveOwner(req);
    if (!callerEmail) return err(res, new Error('Unauthorized'), 401);
    const {name,email,role,modules} = req.body;
    if (!name||!email) return err(res,new Error('name and email required'),400);

    const ctx = loadSeatContext(enterpriseOwner);
    if (!ctx.unlimited) {
      const seat = evaluateAddUser({
        plan: ctx.plan,
        tier: ctx.tier,
        occupancy: ctx.occupancy,
        extraSeats: ctx.extraSeats,
        newModules: modules || [],
        accountUsed: ctx.accountUsed,
      });
      if (seat.error) return err(res, new Error(seat.error), 400);
      if (!seat.allowed) {
        return res.status(402).json({
          ok: false,
          error: `This user needs extra seats: ${seat.extras.map((x) => x.module).join(", ")}. Extra users are 20% off the module list.`,
          need_extra: true,
          quote: seat,
        });
      }
    }

    // 1. Record in admin_users: owner_email = enterprise root, created_by_jwt = actual caller
    const db=getMillDb(); ensureAdminTables(db); ensureOwnerEmailColumn(db);
    const id=randomUUID(); const now=new Date().toISOString();
    const ip=clientIp(req);
    db.prepare(`INSERT INTO admin_users (id,name,email,role,status,modules,created_by,owner_email,created_at,updated_at,created_ip,created_by_jwt) VALUES (?,?,?,?,'active',?,?,?,?,?,?,?)`)
      .run(id,name,email.toLowerCase(),role||'viewer',JSON.stringify(modules||[]),callerEmail,enterpriseOwner,now,now,ip,callerEmail);
    db.prepare(`INSERT INTO admin_activity_log (id,user_id,user_email,action,module,details,ip,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(randomUUID(),id,email.toLowerCase(),'user_created','admin',JSON.stringify({created_by:callerEmail,enterprise_owner:enterpriseOwner,role,modules:modules||[]}),ip,now);
    db.close();

    // 2. Provision login account in np_users + generate setup link
    let setupLink = `${APP_BASE_URL}/reset-password`;
    try {
      setupLink = await provisionLoginAccount(name, email, role, modules || [], enterpriseOwner);
    } catch (provErr) {
      console.error('[admin] provisionLoginAccount failed:', provErr.message);
      // If this is an ownership conflict, roll back the admin_users record and tell the client
      if (provErr.message?.includes('managed by a different owner')) {
        try { const rdb=getMillDb(); rdb.prepare('DELETE FROM admin_users WHERE id=?').run(id); rdb.close(); } catch {}
        return err(res, new Error('This email is already registered as a different user and cannot be added as your sub-user.'), 409);
      }
      // Other provisioning errors: record exists in admin_users but setup link won't work — still succeed
    }

    // 3. Send welcome email with setup link
    const { text, html } = buildWelcomeEmail(name, email, modules || [], setupLink);
    sendMail({ to: email, subject: 'Your AgroCore Prime account is ready — set up your password', text, html })
      .catch(e => console.warn('[admin] welcome email failed:', e.message));

    ok(res,{id,name,email,role,status:'active'});
  } catch(e) { if(e.message?.includes('UNIQUE')) return err(res,new Error('Email already exists'),409); err(res,e); }
});

router.put('/users/:id', (req, res) => {
  try {
    const { callerEmail, enterpriseOwner } = resolveOwner(req);
    if (!callerEmail) return err(res, new Error('Unauthorized'), 401);
    const {name,email,role,modules,status} = req.body;
    const ctx = loadSeatContext(enterpriseOwner);
    if (!ctx.unlimited) {
      const mill = getMillDb();
      ensureAdminTables(mill); ensureOwnerEmailColumn(mill);
      const current = mill.prepare(`SELECT email, status, modules FROM admin_users WHERE id=? AND owner_email=?`).get(req.params.id, enterpriseOwner);
      mill.close();
      const subsEx = (ctx.accountUsed || 1) - (current && String(current.status).toLowerCase() === 'active' ? 1 : 0);
      const occ = { ...ctx.occupancy };
      if (current) {
        let oldMods = [];
        try { oldMods = JSON.parse(current.modules || "[]"); } catch { oldMods = []; }
        for (const m of billedModules(oldMods)) occ[m] = Math.max(0, Number(occ[m] || 0) - 1);
      }
      const seat = evaluateAddUser({
        plan: ctx.plan,
        tier: ctx.tier,
        occupancy: occ,
        extraSeats: ctx.extraSeats,
        newModules: modules || [],
        accountUsed: subsEx,
      });
      if (seat.error) return err(res, new Error(seat.error), 400);
      if (!seat.allowed) {
        return res.status(402).json({
          ok: false,
          error: `This change needs extra seats: ${seat.extras.map((x) => x.module).join(", ")}. Extra users are 20% off the module list.`,
          need_extra: true,
          quote: seat,
        });
      }
    }
    const db=getMillDb(); ensureAdminTables(db); ensureOwnerEmailColumn(db); const now=new Date().toISOString();
    db.prepare(`UPDATE admin_users SET name=?,email=?,role=?,modules=?,status=?,updated_at=? WHERE id=? AND owner_email=?`)
      .run(name,email,role||'viewer',JSON.stringify(modules||[]),status||'active',now,req.params.id,enterpriseOwner);
    db.close();
    syncLoginAccount({
      email,
      name,
      role: role || 'viewer',
      modules: modules || [],
      status: status || 'active',
      ownerEmail: enterpriseOwner,
    });
    ok(res,{id:req.params.id,updated:true});
  } catch(e) { err(res,e); }
});

router.patch('/users/:id/deactivate', (req, res) => {
  try {
    const { callerEmail, enterpriseOwner } = resolveOwner(req);
    if (!callerEmail) return err(res, new Error('Unauthorized'), 401);
    const db=getMillDb(); ensureAdminTables(db); ensureOwnerEmailColumn(db);
    const row = db.prepare('SELECT email, name, role, modules FROM admin_users WHERE id=? AND owner_email=?').get(req.params.id, enterpriseOwner);
    db.prepare(`UPDATE admin_users SET status='inactive',updated_at=? WHERE id=? AND owner_email=?`).run(new Date().toISOString(),req.params.id,enterpriseOwner);
    db.close();
    if (row?.email) {
      const mods = row.modules ? JSON.parse(row.modules) : [];
      syncLoginAccount({ email: row.email, name: row.name, role: row.role, modules: mods, status: 'inactive', ownerEmail: enterpriseOwner });
    }
    ok(res,{id:req.params.id,status:'inactive'});
  } catch(e) { err(res,e); }
});

router.patch('/users/:id/activate', (req, res) => {
  try {
    const { callerEmail, enterpriseOwner } = resolveOwner(req);
    if (!callerEmail) return err(res, new Error('Unauthorized'), 401);
    const db=getMillDb(); ensureAdminTables(db); ensureOwnerEmailColumn(db);
    const row = db.prepare('SELECT email, name, role, modules FROM admin_users WHERE id=? AND owner_email=?').get(req.params.id, enterpriseOwner);
    const ctx = loadSeatContext(enterpriseOwner);
    if (!ctx.unlimited && row) {
      let mods = [];
      try { mods = JSON.parse(row.modules || "[]"); } catch { mods = []; }
      const seat = evaluateAddUser({
        plan: ctx.plan,
        tier: ctx.tier,
        occupancy: ctx.occupancy,
        extraSeats: ctx.extraSeats,
        newModules: mods,
        accountUsed: ctx.accountUsed,
      });
      if (seat.error) { db.close(); return err(res, new Error(seat.error), 400); }
      if (!seat.allowed) {
        db.close();
        return res.status(402).json({
          ok: false,
          error: `Reactivating this user needs extra seats: ${seat.extras.map((x) => x.module).join(", ")}. Extra users are 20% off the module list.`,
          need_extra: true,
          quote: seat,
        });
      }
    }
    db.prepare(`UPDATE admin_users SET status='active',updated_at=? WHERE id=? AND owner_email=?`).run(new Date().toISOString(),req.params.id,enterpriseOwner);
    db.close();
    if (row?.email) {
      const mods = row.modules ? JSON.parse(row.modules) : [];
      syncLoginAccount({ email: row.email, name: row.name, role: row.role, modules: mods, status: 'active', ownerEmail: enterpriseOwner });
    }
    ok(res,{id:req.params.id,status:'active'});
  } catch(e) { err(res,e); }
});

router.delete('/users/:id', (req, res) => {
  try {
    const owner = ownerEmailOf(req);
    if (!owner) return err(res, new Error('Unauthorized'), 401);
    const db = getMillDb(); ensureAdminTables(db); ensureOwnerEmailColumn(db);
    // Get user email before deleting so we can clean up np_users too
    const adminUser = db.prepare('SELECT email FROM admin_users WHERE id=? AND owner_email=?').get(req.params.id, owner);
    db.prepare('DELETE FROM admin_users WHERE id=? AND owner_email=?').run(req.params.id, owner);
    db.close();
    // Also fully remove from np_users so the same email can be re-added
    if (adminUser?.email) {
      try {
        const adb = getAuthDb();
        const npUser = adb.prepare(`SELECT id FROM np_users WHERE LOWER(email)=LOWER(?) AND LOWER(COALESCE(provisioned_by,''))=LOWER(?)`).get(adminUser.email, owner);
        if (npUser) {
          adb.prepare('DELETE FROM password_resets WHERE user_id=?').run(npUser.id);
          adb.prepare('DELETE FROM np_users WHERE id=?').run(npUser.id);
        }
        adb.close();
      } catch (npErr) { console.warn('[admin] np_users cleanup failed:', npErr.message); }
    }
    ok(res, { deleted: req.params.id });
  } catch(e) { err(res, e); }
});

router.post('/users/:id/resend-setup', async (req, res) => {
  try {
    const { callerEmail, enterpriseOwner } = resolveOwner(req);
    if (!callerEmail) return err(res, new Error('Unauthorized'), 401);
    const db = getMillDb(); ensureAdminTables(db); ensureOwnerEmailColumn(db);
    const user = db.prepare('SELECT * FROM admin_users WHERE id=? AND owner_email=?').get(req.params.id, enterpriseOwner);
    db.close();
    if (!user) return err(res, new Error('User not found'), 404);
    const modules = user.modules ? JSON.parse(user.modules) : [];
    const setupLink = await provisionLoginAccount(user.name, user.email, user.role, modules, enterpriseOwner);
    const { text, html } = buildWelcomeEmail(user.name, user.email, modules, setupLink);
    const mailRes = await sendMail({ to: user.email, subject: 'Your AgroCore Prime account — new setup link', text, html });
    ok(res, { sent: mailRes.sent, email: user.email });
  } catch(e) { err(res, e); }
});

// Activity log
router.get('/users/:id/activity', (req, res) => {
  try {
    const db=getMillDb(); ensureAdminTables(db);
    const log = safeAll(db,`SELECT * FROM admin_activity_log WHERE user_id=? ORDER BY created_at DESC LIMIT 20`,[req.params.id]);
    db.close(); ok(res,log);
  } catch(e) { err(res,e); }
});

// ════════════════════════════════════════════════════════════════
// VENDORPULSE DETAIL
// ════════════════════════════════════════════════════════════════
router.get('/module/vendorpulse', (req, res) => {
  try {
    const db=getMillDb(); ensureAdminTables(db);
    const price_submissions = safeAll(db,`SELECT status, COUNT(*) as cnt FROM ingredient_prices GROUP BY status`);
    const recent_pos        = safeAll(db,`SELECT po_number, supplier_name, status, total_usd, created_at FROM purchase_orders ORDER BY created_at DESC LIMIT 10`);
    const suppliers         = safeAll(db,`SELECT name, status, country, currency FROM purchaser_suppliers ORDER BY name`);
    const contracts         = safeAll(db,`SELECT contract_name, supplier_name, expiry_date, CAST((julianday(expiry_date)-julianday('now')) AS INTEGER) as days_remaining FROM supplier_contracts ORDER BY expiry_date ASC LIMIT 10`);

    // Price approval queue
    const pending_queue = safeAll(db,`
      SELECT ip.id, ip.ingredient_name, ip.ingredient_id as ingredient_code,
        ip.price_per_unit as price, ip.currency, ip.weight_unit,
        ROUND(ip.price_per_unit*ip.exchange_rate,2) as usd_price,
        ip.supplier, ip.effective_date, ip.created_at as submitted_at,
        ps.batch_name, ps.submitted_by
      FROM ingredient_prices ip
      LEFT JOIN price_submissions ps ON ps.id=ip.submission_id
      WHERE ip.status='pending_review'
      ORDER BY ip.created_at ASC LIMIT 50
    `);

    // Supplier performance
    const supplier_perf = safeAll(db,`
      SELECT supplier, COUNT(*) as total,
        SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected,
        ROUND(AVG(price_per_unit*exchange_rate),2) as avg_usd
      FROM ingredient_prices
      WHERE supplier IS NOT NULL AND supplier != ''
      GROUP BY supplier ORDER BY total DESC
    `);

    // Batch submission history
    const batch_history = safeAll(db,`
      SELECT ps.batch_name, ps.submitted_by, ps.source,
        COUNT(ip.id) as row_count,
        SUM(CASE WHEN ip.status='approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN ip.status='rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN ip.status='pending_review' THEN 1 ELSE 0 END) as pending,
        ps.created_at
      FROM price_submissions ps
      LEFT JOIN ingredient_prices ip ON ip.submission_id=ps.id
      GROUP BY ps.id ORDER BY ps.created_at DESC LIMIT 20
    `);

    // Cost trend - last 6 months
    const cost_trend = safeAll(db,`
      SELECT strftime('%Y-%m',created_at) as month,
        ROUND(AVG(price_per_unit*exchange_rate),2) as avg_usd,
        COUNT(*) as submissions
      FROM ingredient_prices WHERE status='approved'
      GROUP BY month ORDER BY month ASC LIMIT 6
    `);

    db.close();
    ok(res,{price_submissions,recent_pos,suppliers,contracts,pending_queue,supplier_perf,batch_history,cost_trend});
  } catch(e) { err(res,e); }
});

// Approve price from admin
router.patch('/vendorpulse/prices/:id/approve', (req, res) => {
  try {
    const db=getMillDb(); ensureAdminTables(db);
    const now=new Date().toISOString();
    db.prepare(`UPDATE ingredient_prices SET status='approved', approved_at=? WHERE id=?`).run(now,req.params.id);
    db.close(); ok(res,{id:req.params.id,status:'approved'});
  } catch(e) { err(res,e); }
});

// Reject price from admin
router.patch('/vendorpulse/prices/:id/reject', (req, res) => {
  try {
    const {rejection_note} = req.body;
    const db=getMillDb(); ensureAdminTables(db);
    const now=new Date().toISOString();
    db.prepare(`UPDATE ingredient_prices SET status='rejected', rejection_note=?, rejected_at=? WHERE id=?`).run(rejection_note||'Rejected by admin',now,req.params.id);
    db.close(); ok(res,{id:req.params.id,status:'rejected'});
  } catch(e) { err(res,e); }
});

// ════════════════════════════════════════════════════════════════
// MILLIQ DETAIL
// ════════════════════════════════════════════════════════════════
router.get('/module/milliq', (req, res) => {
  try {
    const db=getMillDb(); ensureAdminTables(db);
    const batches       = safeAll(db,`SELECT batch_number, status, planned_qty_tons, actual_qty_tons, operator_id, created_at FROM mill_batches ORDER BY created_at DESC LIMIT 20`);
    const qc            = safeAll(db,`SELECT overall_status, COUNT(*) as cnt FROM mill_qc_results GROUP BY overall_status`);
    const downtime      = safeAll(db,`SELECT machine, cause_category, duration_minutes, started_at, ended_at FROM mill_downtime_events ORDER BY started_at DESC LIMIT 10`);
    const deviation     = safeAll(db,`SELECT bi.ingredient_name, bi.deviation_pct, bi.deviation_flag, b.batch_number FROM mill_batch_ingredients bi JOIN mill_batches b ON b.id=bi.batch_id WHERE bi.deviation_flag!='none' ORDER BY ABS(bi.deviation_pct) DESC LIMIT 10`);
    const dispatch      = safeAll(db,`SELECT customer_name, quantity_tons, delivery_status, dispatched_at FROM mill_dispatch_records ORDER BY dispatched_at DESC LIMIT 10`);
    const production_by_month = safeAll(db,`SELECT strftime('%Y-%m',created_at) as month, COUNT(*) as batches, ROUND(COALESCE(SUM(planned_qty_tons),0),1) as planned, ROUND(COALESCE(SUM(actual_qty_tons),0),1) as actual FROM mill_batches GROUP BY month ORDER BY month ASC LIMIT 6`);
    const downtime_cost = safeAll(db,`SELECT strftime('%Y-%m',started_at) as month, ROUND(SUM(duration_minutes)/60.0,1) as hours, ROUND(COALESCE(SUM(estimated_cost),0),0) as cost FROM mill_downtime_events GROUP BY month ORDER BY month ASC LIMIT 6`);
    db.close();
    ok(res,{batches,qc,downtime,deviation,dispatch,production_by_month,downtime_cost});
  } catch(e) { err(res,e); }
});

// ════════════════════════════════════════════════════════════════
// FARMPULSE DETAIL
// ════════════════════════════════════════════════════════════════
router.get('/module/farmpulse', (req, res) => {
  try {
    const fdb=getFarmDb();
    const farms   = safeAll(fdb,`SELECT * FROM farms ORDER BY name`);
    const flocks  = safeAll(fdb,`SELECT fl.*, f.name as farm_name FROM flocks fl JOIN farms f ON f.id=fl.farm_id ORDER BY fl.placement_date DESC`);
    const records = safeAll(fdb,`SELECT dr.*, f.name as farm_name, fl.breed, fl.production_type, fl.flock_code FROM daily_records dr JOIN flocks fl ON fl.id=dr.flock_id JOIN farms f ON f.id=fl.farm_id ORDER BY dr.record_date DESC LIMIT 30`);
    const alerts  = safeAll(fdb,`SELECT * FROM alerts ORDER BY created_at DESC LIMIT 20`);

    // Per-farm performance with breed standard comparison
    const farm_detail = safeAll(fdb,`
      SELECT f.id, f.name, f.species, f.location, f.capacity, f.production_focus,
        fl.breed, fl.production_type, fl.flock_code, fl.initial_count, fl.placement_date,
        fl.status as flock_status,
        COUNT(dr.id) as record_count,
        ROUND(AVG(dr.fcr),3) as avg_fcr,
        ROUND(AVG(dr.avg_body_weight_g),0) as avg_bw,
        ROUND(AVG(dr.mortality_rate_pct),3) as avg_mortality,
        ROUND(AVG(dr.feed_intake_per_bird_g),1) as avg_feed_per_bird,
        MAX(dr.avg_body_weight_g) as latest_bw,
        MAX(dr.record_date) as last_record,
        SUM(dr.feed_intake_kg) as total_feed_kg
      FROM farms f
      LEFT JOIN flocks fl ON fl.farm_id=f.id
      LEFT JOIN daily_records dr ON dr.flock_id=fl.id
      WHERE f.status='active'
      GROUP BY f.id, fl.id ORDER BY f.name
    `);

    // FCR trend per farm
    const fcr_by_farm = safeAll(fdb,`
      SELECT f.name as farm_name, dr.record_date, dr.fcr, dr.avg_body_weight_g, dr.age_days
      FROM daily_records dr
      JOIN flocks fl ON fl.id=dr.flock_id
      JOIN farms f ON f.id=fl.farm_id
      WHERE dr.fcr IS NOT NULL
      ORDER BY f.name, dr.record_date ASC
    `);

    // Alert summary by type
    const alert_summary = safeAll(fdb,`SELECT alert_type, severity, COUNT(*) as cnt FROM alerts GROUP BY alert_type, severity ORDER BY cnt DESC`);

    fdb.close();
    ok(res,{farms,flocks,records,alerts,farm_detail,fcr_by_farm,alert_summary});
  } catch(e) { err(res,e); }
});

// Acknowledge farm alert
router.patch('/farmpulse/alerts/:id/acknowledge', (req, res) => {
  try {
    const fdb=getFarmDb();
    fdb.prepare(`UPDATE alerts SET status='acknowledged', updated_at=? WHERE id=?`).run(new Date().toISOString(),req.params.id);
    fdb.close(); ok(res,{id:req.params.id,status:'acknowledged'});
  } catch(e) { err(res,e); }
});

// ════════════════════════════════════════════════════════════════
// PLATFORM HEALTH
// ════════════════════════════════════════════════════════════════
router.get('/health', (req, res) => {
  try {
    const db=getMillDb(); const fdb=getFarmDb();
    ensureAdminTables(db);

    const mill_tables = safeAll(db,`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).map(t=>t.name);
    const farm_tables = safeAll(fdb,`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).map(t=>t.name);

    // Row counts for key tables
    const counts = {};
    const keyTables = ['ingredient_prices','price_submissions','purchase_orders','purchaser_suppliers','supplier_contracts','purchaser_notifications','mill_batches','mill_qc_results','mill_downtime_events','admin_users'];
    for (const t of keyTables) {
      const r = safeGet(db,`SELECT COUNT(*) as c FROM ${t}`);
      counts[t] = r?.c || 0;
    }

    const farm_counts = {};
    const farmTables = ['farms','flocks','daily_records','alerts','feed_batches'];
    for (const t of farmTables) {
      const r = safeGet(fdb,`SELECT COUNT(*) as c FROM ${t}`);
      farm_counts[t] = r?.c || 0;
    }

    // Audit log
    const audit_log = safeAll(db,`SELECT * FROM admin_activity_log ORDER BY created_at DESC LIMIT 20`);

    db.close(); fdb.close();

    ok(res,{
      databases: {
        mill_db:  { status:'connected', tables: mill_tables.length, key_counts: counts },
        farm_db:  { status:'connected', tables: farm_tables.length, key_counts: farm_counts },
      },
      api_version: 'AgroCore v1.4',
      node_version: process.version,
      uptime_seconds: Math.round(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().heapUsed/1024/1024),
      audit_log,
      modules: [
        {name:'NutriX',      route:'/v1/analyze',          status:'active'},
        {name:'MillIQ',      route:'/v1/mill',             status:'active'},
        {name:'VendorPulse', route:'/v1/purchase-orders',  status:'active'},
        {name:'FarmPulse',   route:'/api/farmpulse',       status:'active'},
        {name:'LiveIQ',      route:'/v1/liveiq',           status:'active'},
        {name:'Admin',       route:'/v1/admin',            status:'active'},
      ],
    });
  } catch(e) { err(res,e); }
});

// Audit log
router.post('/audit', (req, res) => {
  try {
    const {user_id,user_email,action,module,details,ip} = req.body;
    const db=getMillDb(); ensureAdminTables(db);
    db.prepare(`INSERT INTO admin_activity_log (id,user_id,user_email,action,module,details,ip,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(randomUUID(),user_id||'',user_email||'',action||'',module||'',details||'',ip||'',new Date().toISOString());
    db.close(); ok(res,{logged:true});
  } catch(e) { err(res,e); }
});

export default router;