import Database from "better-sqlite3";

function encodeOwner(email) {
  return String(email).replace(/@/g, "_at_").replace(/\./g, "_dot_");
}

export const OWNER_EMAIL = "zafar663@hotmail.com";
export const OWNER_MODULES = ["nutrix", "milliq", "farmpulse", "vendorpulse", "lab-quality", "nutrixlite", "liveiq", "admin"];

export function isOwnerEmail(email) {
  const e = String(email || "").toLowerCase().trim();
  return e === OWNER_EMAIL || e === "zafar663@hotmial.com";
}

const OWNER = process.env.SUPER_ADMIN_EMAIL || "feednutritionmillconsulting@gmail.com";
export const USERS_DB = process.env.NUTRIX_DB_PATH
  || `/var/www/nutripilot-agrocore/data/users/${encodeOwner(OWNER)}/nutrix.db`;

export function openUsersDb() {
  const db = new Database(USERS_DB);
  db.exec(`CREATE TABLE IF NOT EXISTS np_payments (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    plan TEXT,
    modules_json TEXT,
    amount_cents INTEGER,
    currency TEXT,
    interval TEXT,
    status TEXT,
    session_id TEXT,
    customer_id TEXT,
    subscription_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  for (const col of ["stripe_customer_id", "stripe_subscription_id", "extra_seats"]) {
    try { db.exec(`ALTER TABLE np_users ADD COLUMN ${col} TEXT`); } catch { /* already present */ }
  }
  return db;
}

export function grantPaidAccount(db, { email, plan, modules, sessionId, customerId, subscriptionId, amountCents, currency, interval }) {
  const addr = String(email || "").toLowerCase().trim();
  if (!addr) return { granted: false };
  const modulesJson = JSON.stringify(modules || []);
  const id = "pay_" + (sessionId || subscriptionId || Date.now());
  db.prepare(`INSERT INTO np_payments (
      id, email, plan, modules_json, amount_cents, currency, interval, status, session_id, customer_id, subscription_id
    ) VALUES (?,?,?,?,?,?,?,'paid',?,?,?)
    ON CONFLICT(id) DO UPDATE SET status='paid', subscription_id=excluded.subscription_id, customer_id=excluded.customer_id`
  ).run(id, addr, plan || "", modulesJson, amountCents || 0, currency || "usd", interval || "month", sessionId || null, customerId || null, subscriptionId || null);

  const user = db.prepare("SELECT id, status FROM np_users WHERE lower(email) = ?").get(addr);
  if (!user) return { granted: false, recorded: true };
  db.prepare(`UPDATE np_users SET
      plan_interest = ?,
      modules_interest = ?,
      stripe_customer_id = COALESCE(?, stripe_customer_id),
      stripe_subscription_id = COALESCE(?, stripe_subscription_id)
    WHERE id = ?`
  ).run(plan || "", modulesJson, customerId || null, subscriptionId || null, user.id);
  return { granted: false, recorded: true, pending: user.status !== "approved" };
}

export function grantOwnerFree(db) {
  let ok = false;
  const addrs = [OWNER_EMAIL, "zafar663@hotmial.com"];
  for (const addr of addrs) {
    const user = db.prepare("SELECT id FROM np_users WHERE lower(email) = ?").get(addr);
    if (!user) continue;
    db.prepare(`UPDATE np_users SET
        status = 'approved',
        plan_granted = 'owner',
        modules_granted = ?,
        approved_at = COALESCE(approved_at, datetime('now'))
      WHERE id = ?`
    ).run(JSON.stringify(OWNER_MODULES), user.id);
    ok = true;
  }
  return ok;
}

export function grantIfPrepaid(email, userId) {
  const db = openUsersDb();
  try {
    const paid = db.prepare(`SELECT plan, modules_json, customer_id, subscription_id
      FROM np_payments WHERE email = ? AND status = 'paid' ORDER BY created_at DESC LIMIT 1`).get(String(email || "").toLowerCase());
    if (!paid) return false;
    db.prepare(`UPDATE np_users SET
        plan_interest = ?, modules_interest = ?,
        stripe_customer_id = ?, stripe_subscription_id = ?
      WHERE id = ?`
    ).run(paid.plan, paid.modules_json, paid.customer_id, paid.subscription_id, userId);
    return false;
  } finally {
    db.close();
  }
}

export function setExtraSeats(db, { email, extra }) {
  const addr = String(email || "").toLowerCase().trim();
  if (!addr) return { granted: false };
  try { db.exec(`ALTER TABLE np_users ADD COLUMN extra_seats TEXT`); } catch { /* exists */ }
  const user = db.prepare("SELECT id, extra_seats FROM np_users WHERE lower(email) = ?").get(addr);
  if (!user) return { granted: false };
  let current = {};
  try { current = JSON.parse(user.extra_seats || "{}") || {}; } catch { current = {}; }
  const next = { ...current };
  for (const [raw, qty] of Object.entries(extra || {})) {
    const key = String(raw || "").toLowerCase() === "labportal" ? "lab-quality" : String(raw || "").toLowerCase();
    next[key] = Math.max(0, Number(qty) || 0);
  }
  db.prepare("UPDATE np_users SET extra_seats = ? WHERE id = ?").run(JSON.stringify(next), user.id);
  return { granted: true, extra: next };
}

export function grantExtraSeats(db, { email, modules, qty }) {
  const addr = String(email || "").toLowerCase().trim();
  if (!addr) return { granted: false };
  try { db.exec(`ALTER TABLE np_users ADD COLUMN extra_seats TEXT`); } catch { /* exists */ }
  const user = db.prepare("SELECT id, extra_seats FROM np_users WHERE lower(email) = ?").get(addr);
  if (!user) return { granted: false };
  let extra = {};
  try { extra = JSON.parse(user.extra_seats || "{}") || {}; } catch { extra = {}; }
  const n = Math.max(1, Number(qty) || 1);
  for (const raw of modules || []) {
    const key = String(raw || "").toLowerCase() === "labportal" ? "lab-quality" : String(raw || "").toLowerCase();
    extra[key] = Number(extra[key] || 0) + n;
  }
  db.prepare("UPDATE np_users SET extra_seats = ? WHERE id = ?").run(JSON.stringify(extra), user.id);
  return { granted: true, extra };
}

export function endSubscription(subscriptionId) {
  if (!subscriptionId) return;
  const db = openUsersDb();
  try {
    db.prepare(`UPDATE np_payments SET status = 'canceled' WHERE subscription_id = ?`).run(subscriptionId);
    db.prepare(`UPDATE np_users SET status = 'suspended' WHERE stripe_subscription_id = ?`).run(subscriptionId);
  } finally {
    db.close();
  }
}
