import crypto from "crypto";
import { grantPaidAccount, setExtraSeats } from "./billing-grant.js";

const LINE_NAMES = {
  nutrix: "NutriX extra seat",
  milliq: "Mill IQ extra seat",
  farmpulse: "FarmPulse extra seat",
  vendorpulse: "VendorPulse extra seat",
  "lab-quality": "Lab Portal extra seat",
};

export function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

export function newPayToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function ensureInvoiceTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS np_invoices (
    id TEXT PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    payload TEXT,
    expected_cents INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    session_id TEXT,
    status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT (datetime('now')),
    paid_at TEXT
  )`);
}

export function createInvoice(db, { user, quoted, extra_seats, modules, chargePlan, chargeExtras, annual }) {
  ensureInvoiceTable(db);
  const token = newPayToken();
  const id = "inv_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");
  const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const payload = {
    quoted,
    extra_seats,
    modules,
    chargePlan: !!chargePlan,
    chargeExtras: !!chargeExtras,
    annual: !!annual,
    full_name: user.full_name || "",
    company_name: user.company_name || "",
    country: user.country || "",
    plan: quoted.plan || "",
  };
  db.prepare(
    `INSERT INTO np_invoices (id, token_hash, user_id, email, payload, expected_cents, expires_at, status)
     VALUES (?,?,?,?,?,?,?,'open')`
  ).run(id, tokenHash(token), user.id, String(user.email || "").toLowerCase(), JSON.stringify(payload), quoted.dollars * 100, expires);
  return { id, token, expires_at: expires };
}

export function findInvoiceByToken(db, token) {
  ensureInvoiceTable(db);
  if (!/^[a-f0-9]{64}$/i.test(String(token || ""))) return null;
  return db.prepare("SELECT * FROM np_invoices WHERE token_hash = ?").get(tokenHash(token));
}

export function publicInvoiceView(row) {
  if (!row) return null;
  if (row.status === "paid") return { status: "paid", message: "This invoice has already been paid." };
  if (new Date(row.expires_at).getTime() < Date.now() || row.status === "expired") {
    return { status: "expired", message: "This payment link has expired. Ask AgroCore for a new one." };
  }
  if (row.status !== "open") return { status: row.status, message: "This payment link is no longer valid." };
  let payload = {};
  try { payload = JSON.parse(row.payload || "{}") || {}; } catch { payload = {}; }
  const quoted = payload.quoted || {};
  return {
    status: "open",
    email: row.email,
    name: payload.full_name || "",
    company: payload.company_name || "",
    country: payload.country || "",
    plan: quoted.plan || payload.plan || "",
    lines: (quoted.lines || []).map((line) => ({
      label: line.kind === "plan"
        ? `AgroCore Prime ${line.name || "plan"}`
        : LINE_NAMES[line.module] || `Extra ${line.module} seat`,
      qty: line.qty || 1,
      monthly: line.monthly,
    })),
    monthly: quoted.monthly || 0,
    dollars: quoted.dollars || Math.round((row.expected_cents || 0) / 100),
    interval: quoted.interval || "month",
    expires_at: row.expires_at,
    locked: true,
  };
}

export function stripeLineItems(quoted) {
  const annual = quoted.interval === "year";
  return (quoted.lines || []).map((line) => {
    const qty = Math.max(1, Number(line.qty) || 1);
    const unit = Number(line.unit) || 0;
    const name = line.kind === "plan"
      ? `AgroCore Prime ${String(line.name || "plan")}`
      : LINE_NAMES[line.module] || "AgroCore Prime extra seat";
    return {
      quantity: qty,
      price_data: {
        currency: "usd",
        unit_amount: (annual ? unit * 11 : unit) * 100,
        recurring: { interval: annual ? "year" : "month" },
        product_data: {
          name,
          description: "Billed to the AgroCore Prime account named on this invoice. Seats apply only to that account.",
        },
      },
    };
  }).filter((item) => item.price_data.unit_amount > 0);
}

export function fulfillAdminInvoice(db, session) {
  ensureInvoiceTable(db);
  const invoiceId = session.metadata?.invoice_id;
  const userId = session.metadata?.user_id;
  if (!invoiceId || !userId) return { ok: false, error: "missing invoice" };
  if (session.payment_status && session.payment_status !== "paid") {
    return { ok: false, error: "not paid" };
  }
  const inv = db.prepare("SELECT * FROM np_invoices WHERE id = ?").get(invoiceId);
  if (!inv) return { ok: false, error: "invoice not found" };
  if (inv.status === "paid") return { ok: true, duplicate: true };
  if (inv.user_id !== userId) return { ok: false, error: "user mismatch" };
  const intended = String(inv.email || "").toLowerCase();
  const metaEmail = String(session.metadata?.email || "").toLowerCase();
  if (!intended || metaEmail !== intended) return { ok: false, error: "email mismatch" };
  const expected = Number(inv.expected_cents) || 0;
  const got = Number(session.amount_total) || 0;
  if (expected && got && expected !== got) {
    console.error("[invoice] amount mismatch", { invoiceId, expected, got });
    return { ok: false, error: "amount mismatch" };
  }
  let payload = {};
  try { payload = JSON.parse(inv.payload || "{}") || {}; } catch { payload = {}; }
  const modules = payload.modules || [];
  grantPaidAccount(db, {
    email: intended,
    plan: session.metadata?.plan || payload.quoted?.plan || "",
    modules,
    sessionId: session.id,
    customerId: session.customer || null,
    subscriptionId: session.subscription || null,
    amountCents: got,
    currency: session.currency || "usd",
    interval: session.metadata?.interval || payload.quoted?.interval || "month",
  });
  if (payload.extra_seats && Object.keys(payload.extra_seats).length) {
    setExtraSeats(db, { email: intended, extra: payload.extra_seats });
  }
  db.prepare(`UPDATE np_invoices SET status='paid', paid_at=datetime('now'), session_id=? WHERE id=?`).run(session.id, inv.id);
  try { db.exec(`ALTER TABLE np_users ADD COLUMN pending_invoice TEXT`); } catch { /* exists */ }
  db.prepare(`UPDATE np_users SET pending_invoice = NULL WHERE id = ?`).run(inv.user_id);
  return { ok: true };
}
