import express from "express";
import Stripe from "stripe";
import { openUsersDb, grantPaidAccount, grantExtraSeats, endSubscription, isOwnerEmail } from "../lib/billing-grant.js";
import { extraSeatMonthly, billedModules } from "../lib/seats.js";
import { fulfillAdminInvoice, findInvoiceByToken, publicInvoiceView, stripeLineItems } from "../lib/invoices.js";

const router = express.Router();
const APP_URL = process.env.APP_URL || "https://agrocoreprime.com";

const TIER = { 1: 1, 2: 0.75, 3: 0.5, 4: 0.3 };
const COUNTRY_TIER = {
  "united states": 1, usa: 1, us: 1, "united states of america": 1, america: 1,
  "united kingdom": 1, uk: 1, "great britain": 1, britain: 1, england: 1,
  germany: 1, deutschland: 1, france: 1, australia: 1, canada: 1, japan: 1,
  "south korea": 1, korea: 1, "republic of korea": 1, singapore: 1,
  uae: 1, "united arab emirates": 1, "saudi arabia": 1, ksa: 1, qatar: 1, kuwait: 1,
  switzerland: 1, norway: 1, sweden: 1, denmark: 1, netherlands: 1, holland: 1,
  "new zealand": 1, ireland: 1, austria: 1, belgium: 1, finland: 1, spain: 1, italy: 1,
  portugal: 1, greece: 1, luxembourg: 1, iceland: 1, bahrain: 1, oman: 1, brunei: 1,
  "hong kong": 1, macau: 1, macao: 1, malta: 1, cyprus: 1, estonia: 1, latvia: 1,
  lithuania: 1, slovenia: 1, slovakia: 1, liechtenstein: 1, monaco: 1, andorra: 1,
  "puerto rico": 1,
  india: 2, china: 2, prc: 2, brazil: 2, turkey: 2, turkiye: 2, "south africa": 2,
  malaysia: 2, mexico: 2, poland: 2, argentina: 2, russia: 2, "russian federation": 2,
  indonesia: 2, chile: 2, israel: 2, "czech republic": 2, czechia: 2, romania: 2, taiwan: 2,
  hungary: 2, bulgaria: 2, croatia: 2, serbia: 2, kazakhstan: 2, "costa rica": 2, panama: 2,
  uruguay: 2, "dominican republic": 2, mauritius: 2, botswana: 2, namibia: 2, georgia: 2,
  armenia: 2, azerbaijan: 2, belarus: 2, "bosnia and herzegovina": 2, montenegro: 2,
  "north macedonia": 2, macedonia: 2, albania: 2, maldives: 2, "sri lanka": 2, mongolia: 2,
  paraguay: 2, ecuador: 2, jamaica: 2, "trinidad and tobago": 2, lebanon: 2, tunisia: 2,
  iran: 2, iraq: 2, libya: 2, uzbekistan: 2, moldova: 2,
  pakistan: 3, nigeria: 3, egypt: 3, vietnam: 3, "viet nam": 3, thailand: 3, colombia: 3,
  peru: 3, venezuela: 3, syria: 3, philippines: 3, morocco: 3, kenya: 3, bangladesh: 3,
  ghana: 3, jordan: 3, ukraine: 3, algeria: 3, bolivia: 3, guatemala: 3, honduras: 3,
  "el salvador": 3, nicaragua: 3, cuba: 3, senegal: 3, cameroon: 3, "ivory coast": 3,
  angola: 3, mozambique: 3, zambia: 3, zimbabwe: 3, rwanda: 3, madagascar: 3, sudan: 3,
  yemen: 3, laos: 3, "papua new guinea": 3,
  ethiopia: 4, tanzania: 4, uganda: 4, nepal: 4, cambodia: 4, myanmar: 4, mali: 4, niger: 4,
  afghanistan: 4, haiti: 4, "burkina faso": 4, chad: 4, somalia: 4, "south sudan": 4,
  malawi: 4, burundi: 4, "sierra leone": 4, liberia: 4, guinea: 4, gambia: 4,
  "central african republic": 4, "democratic republic of the congo": 4, drc: 4, congo: 4,
  benin: 4, togo: 4, mauritania: 4, eritrea: 4, djibouti: 4, lesotho: 4, eswatini: 4,
  swaziland: 4, bhutan: 4, tajikistan: 4, kyrgyzstan: 4,   "timor-leste": 4, "east timor": 4,
};

const ISO_GEO = {
  US: ["United States", 1], GB: ["United Kingdom", 1], DE: ["Germany", 1], FR: ["France", 1],
  AU: ["Australia", 1], CA: ["Canada", 1], JP: ["Japan", 1], KR: ["South Korea", 1], SG: ["Singapore", 1],
  AE: ["UAE", 1], SA: ["Saudi Arabia", 1], QA: ["Qatar", 1], KW: ["Kuwait", 1], CH: ["Switzerland", 1],
  NO: ["Norway", 1], SE: ["Sweden", 1], DK: ["Denmark", 1], NL: ["Netherlands", 1], NZ: ["New Zealand", 1],
  IE: ["Ireland", 1], AT: ["Austria", 1], BE: ["Belgium", 1], FI: ["Finland", 1], ES: ["Spain", 1],
  IT: ["Italy", 1], PT: ["Portugal", 1], GR: ["Greece", 1], LU: ["Luxembourg", 1], IS: ["Iceland", 1],
  BH: ["Bahrain", 1], OM: ["Oman", 1], BN: ["Brunei", 1], HK: ["Hong Kong", 1], MO: ["Macau", 1],
  MT: ["Malta", 1], CY: ["Cyprus", 1], EE: ["Estonia", 1], LV: ["Latvia", 1], LT: ["Lithuania", 1],
  SI: ["Slovenia", 1], SK: ["Slovakia", 1], LI: ["Liechtenstein", 1], MC: ["Monaco", 1], AD: ["Andorra", 1],
  PR: ["Puerto Rico", 1],
  IN: ["India", 2], CN: ["China", 2], BR: ["Brazil", 2], TR: ["Turkey", 2], ZA: ["South Africa", 2],
  MY: ["Malaysia", 2], MX: ["Mexico", 2], PL: ["Poland", 2], AR: ["Argentina", 2], RU: ["Russia", 2],
  ID: ["Indonesia", 2], CL: ["Chile", 2], IL: ["Israel", 2], CZ: ["Czech Republic", 2], RO: ["Romania", 2],
  TW: ["Taiwan", 2], HU: ["Hungary", 2], BG: ["Bulgaria", 2], HR: ["Croatia", 2], RS: ["Serbia", 2],
  KZ: ["Kazakhstan", 2], CR: ["Costa Rica", 2], PA: ["Panama", 2], UY: ["Uruguay", 2],
  DO: ["Dominican Republic", 2], MU: ["Mauritius", 2], BW: ["Botswana", 2], NA: ["Namibia", 2],
  GE: ["Georgia", 2], AM: ["Armenia", 2], AZ: ["Azerbaijan", 2], BY: ["Belarus", 2],
  BA: ["Bosnia and Herzegovina", 2], ME: ["Montenegro", 2], MK: ["North Macedonia", 2], AL: ["Albania", 2],
  MV: ["Maldives", 2], LK: ["Sri Lanka", 2], MN: ["Mongolia", 2], PY: ["Paraguay", 2], EC: ["Ecuador", 2],
  JM: ["Jamaica", 2], TT: ["Trinidad and Tobago", 2], LB: ["Lebanon", 2], TN: ["Tunisia", 2],
  IR: ["Iran", 2], IQ: ["Iraq", 2], LY: ["Libya", 2], UZ: ["Uzbekistan", 2], MD: ["Moldova", 2],
  PK: ["Pakistan", 3], NG: ["Nigeria", 3], EG: ["Egypt", 3], VN: ["Vietnam", 3], TH: ["Thailand", 3],
  CO: ["Colombia", 3], PE: ["Peru", 3], VE: ["Venezuela", 3], SY: ["Syria", 3], PH: ["Philippines", 3],
  MA: ["Morocco", 3], KE: ["Kenya", 3], BD: ["Bangladesh", 3], GH: ["Ghana", 3], JO: ["Jordan", 3],
  UA: ["Ukraine", 3], DZ: ["Algeria", 3], BO: ["Bolivia", 3], GT: ["Guatemala", 3], HN: ["Honduras", 3],
  SV: ["El Salvador", 3], NI: ["Nicaragua", 3], CU: ["Cuba", 3], SN: ["Senegal", 3], CM: ["Cameroon", 3],
  CI: ["Ivory Coast", 3], AO: ["Angola", 3], MZ: ["Mozambique", 3], ZM: ["Zambia", 3], ZW: ["Zimbabwe", 3],
  RW: ["Rwanda", 3], MG: ["Madagascar", 3], SD: ["Sudan", 3], YE: ["Yemen", 3], LA: ["Laos", 3],
  PG: ["Papua New Guinea", 3],
  ET: ["Ethiopia", 4], TZ: ["Tanzania", 4], UG: ["Uganda", 4], NP: ["Nepal", 4], KH: ["Cambodia", 4],
  MM: ["Myanmar", 4], ML: ["Mali", 4], NE: ["Niger", 4], AF: ["Afghanistan", 4], HT: ["Haiti", 4],
  BF: ["Burkina Faso", 4], TD: ["Chad", 4], SO: ["Somalia", 4], SS: ["South Sudan", 4], MW: ["Malawi", 4],
  BI: ["Burundi", 4], SL: ["Sierra Leone", 4], LR: ["Liberia", 4], GN: ["Guinea", 4], GM: ["Gambia", 4],
  CF: ["Central African Republic", 4], CD: ["Democratic Republic of the Congo", 4], CG: ["Congo", 4],
  BJ: ["Benin", 4], TG: ["Togo", 4], MR: ["Mauritania", 4], ER: ["Eritrea", 4], DJ: ["Djibouti", 4],
  LS: ["Lesotho", 4], SZ: ["Eswatini", 4], BT: ["Bhutan", 4], TJ: ["Tajikistan", 4], KG: ["Kyrgyzstan", 4],
  TL: ["Timor-Leste", 4],
};

const MODULES = {
  nutrix: { name: "NutriX", monthly: 249, anchor: true },
  milliq: { name: "Mill IQ", monthly: 149, anchor: true },
  farmpulse: { name: "FarmPulse", monthly: 99, anchor: true },
  vendorpulse: { name: "VendorPulse", monthly: 149, anchor: false },
  labportal: { name: "Lab Portal", monthly: 25, anchor: false },
};

const PLANS = {
  starter: { name: "Starter", monthly: 249, modules: ["nutrix"] },
  pro: { name: "Pro", monthly: 398, modules: ["nutrix", "milliq"] },
  proplus: { name: "Pro Plus", monthly: 497, modules: ["nutrix", "milliq", "farmpulse"] },
  enterprise: { name: "Enterprise", monthly: 646, modules: ["nutrix", "milliq", "farmpulse", "vendorpulse"] },
};

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

function tierFor(country) {
  const raw = String(country || "").trim();
  if (!raw) return 1;
  if (raw.length === 2 && ISO_GEO[raw.toUpperCase()]) return ISO_GEO[raw.toUpperCase()][1];
  const name = raw.toLowerCase().replace(/\s+/g, " ");
  if (COUNTRY_TIER[name]) return COUNTRY_TIER[name];
  if (name.length < 4) return 1;
  const key = Object.keys(COUNTRY_TIER).find((k) => k.length >= 4 && (name.includes(k) || k.includes(name)));
  return key ? COUNTRY_TIER[key] : 1;
}

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const real = String(req.headers["x-real-ip"] || "").trim();
  return (fwd || real || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
}

function isPrivateIp(ip) {
  return !ip || ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
}

async function resolveGeo(req) {
  const header = String(
    req.headers["cf-ipcountry"] ||
    req.headers["x-vercel-ip-country"] ||
    req.headers["cloudfront-viewer-country"] ||
    ""
  ).toUpperCase();
  if (header && header !== "XX" && ISO_GEO[header]) {
    return { code: header, name: ISO_GEO[header][0], tier: ISO_GEO[header][1], detected: true };
  }
  const ip = clientIp(req);
  if (!isPrivateIp(ip)) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch(`https://api.country.is/${encodeURIComponent(ip)}`, { signal: ctl.signal });
      clearTimeout(timer);
      const data = await res.json();
      const code = String(data.country || "").toUpperCase();
      if (ISO_GEO[code]) return { code, name: ISO_GEO[code][0], tier: ISO_GEO[code][1], detected: true };
    } catch { /* fall through */ }
  }
  return { code: "US", name: "United States", tier: 1, detected: false };
}

function planPricesFor(tier) {
  return {
    starter: priced(PLANS.starter.monthly, tier),
    pro: priced(PLANS.pro.monthly, tier),
    proplus: priced(PLANS.proplus.monthly, tier),
    enterprise: priced(PLANS.enterprise.monthly, tier),
  };
}

function priced(base, tier) {
  return Math.round(base * (TIER[tier] || 1));
}

function quote(body) {
  const tier = tierFor(body.country);
  const annual = !!body.annual;
  const planKey = String(body.plan || "").toLowerCase();
  if (PLANS[planKey]) {
    const plan = PLANS[planKey];
    const monthly = priced(plan.monthly, tier);
    return {
      name: `AgroCore Prime ${plan.name}`,
      dollars: annual ? monthly * 11 : monthly,
      interval: annual ? "year" : "month",
      modules: plan.modules,
      plan: planKey,
    };
  }
  const anchors = [...new Set((body.anchors || []).map((k) => String(k).toLowerCase()))].filter((k) => MODULES[k]?.anchor).slice(0, 3);
  const addons = [...new Set((body.addons || []).map((k) => String(k).toLowerCase()))].filter((k) => MODULES[k] && !MODULES[k].anchor);
  if (!anchors.length) return { error: "Choose a plan or at least one module" };
  const hasVendor = addons.includes("vendorpulse");
  const hasLab = addons.includes("labportal");
  let plan = "";
  const picked = anchors.length + addons.length;
  if (anchors.length === 3 && hasVendor && hasLab) plan = "enterprise";
  else if (picked >= 4) plan = "enterprise";
  else if (picked === 3) plan = "proplus";
  else if (picked === 2) plan = "pro";
  else if (picked === 1 && addons.length === 0) plan = "starter";
  if (plan) return quote({ plan, annual, country: body.country });
  const disc = anchors.length >= 3 ? 0.15 : anchors.length >= 2 ? 0.10 : 0;
  let monthly = 0;
  for (const key of anchors) monthly += priced(MODULES[key].monthly, tier);
  for (const key of addons) monthly += Math.round(priced(MODULES[key].monthly, tier) * (1 - disc));
  const access = [...anchors, ...addons].filter((k) => k !== "labportal");
  return {
    name: "AgroCore Prime stack",
    dollars: annual ? monthly * 11 : monthly,
    interval: annual ? "year" : "month",
    modules: access.length ? access : ["nutrix"],
    plan: "stack",
  };
}

router.get("/v1/billing/geo", async (req, res) => {
  try {
    const geo = await resolveGeo(req);
    return res.json({
      ok: true,
      detected: !!geo.detected,
      country: geo.name,
      code: geo.code,
      tier: geo.tier,
      pct: Math.round((TIER[geo.tier] || 1) * 100),
      prices: planPricesFor(geo.tier),
    });
  } catch (e) {
    console.error("[billing] geo", e.message);
    return res.json({
      ok: true,
      country: "United States",
      code: "US",
      tier: 1,
      pct: 100,
      prices: planPricesFor(1),
    });
  }
});

router.post("/v1/billing/checkout", async (req, res) => {
  try {
    const stripe = stripeClient();
    if (!stripe) return res.status(503).json({ ok: false, error: "Card payments are not switched on yet." });
    const email = String(req.body?.email || "").toLowerCase().trim();
    if (isOwnerEmail(email)) return res.json({ ok: true, free: true });
    const geo = await resolveGeo(req);
    const country = String(req.body?.country || "").trim() || geo.name;
    const quoted = quote({ ...(req.body || {}), country });
    if (quoted.error) return res.status(400).json({ ok: false, error: quoted.error });
    if (!quoted.dollars || quoted.dollars < 1) return res.status(400).json({ ok: false, error: "This selection has no charge." });
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: quoted.dollars * 100,
          recurring: { interval: quoted.interval },
          product_data: { name: quoted.name },
        },
      }],
      customer_email: email || undefined,
      success_url: `${APP_URL}/?access=submitted`,
      cancel_url: `${APP_URL}/?access=cancelled`,
      metadata: {
        plan: quoted.plan,
        modules: quoted.modules.join(","),
        interval: quoted.interval,
        email,
        country,
        tier: String(tierFor(country)),
      },
      subscription_data: {
        metadata: { plan: quoted.plan, modules: quoted.modules.join(",") },
      },
    });
    return res.json({ ok: true, url: session.url });
  } catch (e) {
    console.error("[billing] checkout", e.message);
    return res.status(500).json({ ok: false, error: "Payment could not be started." });
  }
});

router.post("/v1/billing/extra-seat", async (req, res) => {
  try {
    const stripe = stripeClient();
    if (!stripe) return res.status(503).json({ ok: false, error: "Card payments are not switched on yet." });
    const email = String(req.body?.email || "").toLowerCase().trim();
    if (!email) return res.status(400).json({ ok: false, error: "Email is required." });
    if (isOwnerEmail(email)) return res.json({ ok: true, free: true });
    const geo = await resolveGeo(req);
    const country = String(req.body?.country || "").trim() || geo.name;
    const modules = billedModules(req.body?.modules || []);
    if (!modules.length) return res.status(400).json({ ok: false, error: "Choose the module this extra user will access." });
    const qty = Math.max(1, Number(req.body?.qty) || 1);
    const annual = !!req.body?.annual;
    const tier = tierFor(country);
    let monthly = 0;
    for (const m of modules) monthly += extraSeatMonthly(m, tier);
    const dollars = (annual ? monthly * 11 : monthly) * qty;
    if (dollars < 1) return res.status(400).json({ ok: false, error: "This extra seat has no charge." });
    const names = modules.join(", ");
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: dollars * 100,
          recurring: { interval: annual ? "year" : "month" },
          product_data: { name: `AgroCore Prime extra user (${names})` },
        },
      }],
      customer_email: email || undefined,
      success_url: `${APP_URL}/admin-portal?seats=paid`,
      cancel_url: `${APP_URL}/admin-portal?seats=cancelled`,
      metadata: {
        kind: "extra_seat",
        plan: "extra_seat",
        modules: modules.join(","),
        qty: String(qty),
        interval: annual ? "year" : "month",
        email,
        country,
      },
    });
    return res.json({ ok: true, url: session.url, dollars, modules, qty });
  } catch (e) {
    console.error("[billing] extra-seat", e.message);
    return res.status(500).json({ ok: false, error: "Extra-user payment could not be started." });
  }
});

router.get("/v1/billing/invoice/:token", (req, res) => {
  try {
    const db = openUsersDb();
    try {
      const inv = findInvoiceByToken(db, req.params.token);
      const view = publicInvoiceView(inv);
      if (!view) return res.status(404).json({ ok: false, error: "This payment link is not valid." });
      return res.json({ ok: true, ...view });
    } finally { db.close(); }
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Invoice could not be loaded." });
  }
});

router.post("/v1/billing/invoice/:token/checkout", async (req, res) => {
  try {
    const stripe = stripeClient();
    if (!stripe) return res.status(503).json({ ok: false, error: "Card payments are not switched on yet." });
    const db = openUsersDb();
    let inv;
    try {
      inv = findInvoiceByToken(db, req.params.token);
      const view = publicInvoiceView(inv);
      if (!view) { db.close(); return res.status(404).json({ ok: false, error: "This payment link is not valid." }); }
      if (view.status !== "open") { db.close(); return res.status(409).json({ ok: false, error: view.message, status: view.status }); }
      if (inv.session_id) {
        try {
          const existing = await stripe.checkout.sessions.retrieve(inv.session_id);
          if (existing?.status === "open" && existing.url) {
            db.close();
            return res.json({ ok: true, url: existing.url });
          }
        } catch { /* create a new session */ }
      }
      let payload = {};
      try { payload = JSON.parse(inv.payload || "{}") || {}; } catch { payload = {}; }
      const quoted = payload.quoted || {};
      const items = stripeLineItems(quoted);
      if (!items.length) { db.close(); return res.status(400).json({ ok: false, error: "This invoice has no charge." }); }
      const email = String(inv.email || "").toLowerCase();
      const listed = await stripe.customers.list({ email, limit: 1 });
      const customer = listed.data[0] || await stripe.customers.create({
        email,
        name: payload.full_name || undefined,
        metadata: { np_user_id: inv.user_id },
      });
      const now = Math.floor(Date.now() / 1000);
      const invExp = Math.floor(new Date(inv.expires_at).getTime() / 1000);
      if (invExp - now < 1800) {
        db.close();
        return res.status(409).json({ ok: false, error: "This payment link has expired. Ask AgroCore for a new one.", status: "expired" });
      }
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customer.id,
        client_reference_id: inv.user_id,
        line_items: items,
        expires_at: Math.min(invExp, now + 23 * 3600),
        success_url: `${APP_URL}/pay?t=${encodeURIComponent(req.params.token)}&paid=1`,
        cancel_url: `${APP_URL}/pay?t=${encodeURIComponent(req.params.token)}&paid=0`,
        billing_address_collection: "required",
        custom_text: {
          submit: { message: `This payment is locked to ${email}. Seats are applied only to that AgroCore Prime account.` },
          after_submit: { message: "Payment received. AgroCore will confirm access on the account named on this invoice." },
        },
        metadata: {
          kind: "admin_invoice",
          invoice_id: inv.id,
          user_id: inv.user_id,
          plan: quoted.plan || "",
          modules: (payload.modules || []).join(","),
          extra_seats: JSON.stringify(payload.extra_seats || {}),
          interval: quoted.interval || "month",
          email,
          expected_cents: String(inv.expected_cents || ""),
        },
        subscription_data: {
          description: `AgroCore Prime · ${email}`,
          metadata: { kind: "admin_invoice", invoice_id: inv.id, user_id: inv.user_id, email },
        },
      });
      db.prepare("UPDATE np_invoices SET session_id = ? WHERE id = ?").run(session.id, inv.id);
      db.close();
      return res.json({ ok: true, url: session.url });
    } catch (e) {
      try { db.close(); } catch { /* */ }
      throw e;
    }
  } catch (e) {
    console.error("[billing] invoice checkout", e.message);
    return res.status(500).json({ ok: false, error: "Secure checkout could not be started." });
  }
});

export async function stripeWebhook(req, res) {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return res.status(503).send("Stripe is not configured");
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret);
  } catch (e) {
    return res.status(400).send("Invalid Stripe signature");
  }
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const email = session.metadata?.email || session.customer_details?.email || session.customer_email;
      const modules = String(session.metadata?.modules || "").split(",").map((s) => s.trim()).filter(Boolean);
      const db = openUsersDb();
      try {
        if (session.metadata?.kind === "extra_seat") {
          grantExtraSeats(db, {
            email,
            modules,
            qty: Number(session.metadata?.qty) || 1,
          });
        } else if (session.metadata?.kind === "admin_invoice") {
          const result = fulfillAdminInvoice(db, session);
          if (!result.ok) console.error("[billing] admin_invoice rejected", result.error);
        } else {
          grantPaidAccount(db, {
            email,
            plan: session.metadata?.plan || "",
            modules,
            sessionId: session.id,
            customerId: session.customer || null,
            subscriptionId: session.subscription || null,
            amountCents: session.amount_total || 0,
            currency: session.currency || "usd",
            interval: session.metadata?.interval || "month",
          });
        }
      } finally {
        db.close();
      }
    }
    if (event.type === "customer.subscription.deleted") {
      endSubscription(event.data.object.id);
    }
    return res.json({ received: true });
  } catch (e) {
    console.error("[billing] webhook", e.message);
    return res.status(500).send("Webhook failed");
  }
}

export default router;
