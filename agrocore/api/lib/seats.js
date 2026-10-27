/** Included seats vs extra users (20% off the country-tiered module list). */

export const SEAT_MODULES = ["nutrix", "milliq", "farmpulse", "vendorpulse", "lab-quality"];
export const MODULE_LIST = {
  nutrix: 249,
  milliq: 149,
  farmpulse: 99,
  vendorpulse: 149,
  "lab-quality": 25,
  labportal: 25,
};
export const EXTRA_FACTOR = 0.8;
const TIER = { 1: 1, 2: 0.75, 3: 0.5, 4: 0.3 };

export function normalizeMod(key) {
  const k = String(key || "").toLowerCase();
  if (k === "labportal" || k === "lab") return "lab-quality";
  if (k === "milli q" || k === "milliq") return "milliq";
  return k;
}

export function billedModules(list) {
  return [...new Set((list || []).map(normalizeMod))].filter((k) => SEAT_MODULES.includes(k));
}

export function normalizePlan(plan) {
  const p = String(plan || "").toLowerCase().replace(/[-_\s]+/g, "");
  if (p === "proplus") return "proplus";
  if (["owner", "custom", "org", "organisation", "organizationsuite"].includes(p)) return "unlimited";
  if (["starter", "pro", "enterprise"].includes(p)) return p;
  return p || "starter";
}

export function includedAccountSeats(plan) {
  const p = normalizePlan(plan);
  if (p === "starter") return 1;
  if (p === "pro") return 2;
  if (p === "proplus") return 3;
  return 0;
}

export function includedPerModule(plan) {
  return normalizePlan(plan) === "enterprise" ? 2 : 0;
}

export function extraSeatMonthly(moduleKey, tier) {
  const base = MODULE_LIST[normalizeMod(moduleKey)] || 0;
  const country = Math.round(base * (TIER[tier] || 1));
  return Math.round(country * EXTRA_FACTOR);
}

export const PLAN_LIST = { starter: 249, pro: 398, proplus: 497, enterprise: 646 };

export function quoteCharge({
  plan,
  extraSeats = {},
  currentExtra = {},
  chargePlan = false,
  chargeExtras = true,
  annual = false,
  tier = 1,
}) {
  const lines = [];
  let monthly = 0;
  const p = normalizePlan(plan);
  if (chargePlan && PLAN_LIST[p]) {
    const amt = Math.round(PLAN_LIST[p] * (TIER[tier] || 1));
    lines.push({ kind: "plan", name: p, qty: 1, unit: amt, monthly: amt });
    monthly += amt;
  }
  if (chargeExtras) {
    for (const m of SEAT_MODULES) {
      const next = Math.max(0, Number(extraSeats[m] || extraSeats[m === "lab-quality" ? "labportal" : m] || 0));
      const cur = Math.max(0, Number(currentExtra[m] || currentExtra[m === "lab-quality" ? "labportal" : m] || 0));
      const qty = Math.max(0, next - cur);
      if (!qty) continue;
      const unit = extraSeatMonthly(m, tier);
      lines.push({ kind: "extra", module: m, qty, unit, monthly: unit * qty });
      monthly += unit * qty;
    }
  }
  return {
    monthly,
    dollars: annual ? monthly * 11 : monthly,
    interval: annual ? "year" : "month",
    lines,
    tier: Number(tier) || 1,
    plan: p,
  };
}

export function parseExtraSeats(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

/**
 * occupancy: { moduleKey: usedCount } including the owner on each of their modules
 * accountUsed: total people (owner + active sub-users)
 * extraSeats: { moduleKey: paidExtraCount }
 */
export function evaluateAddUser({
  plan,
  tier = 1,
  occupancy = {},
  extraSeats = {},
  newModules = [],
  accountUsed = 1,
}) {
  const p = normalizePlan(plan);
  const mods = billedModules(newModules);
  if (p === "unlimited") {
    return { allowed: true, included: true, extras: [], monthly: 0, label: "Custom / owner — no seat limit" };
  }
  if (!mods.length) {
    return { allowed: false, included: false, extras: [], monthly: 0, error: "Assign at least one billed module" };
  }

  const extras = [];
  const pushExtra = (m) => extras.push({
    module: m,
    monthly: extraSeatMonthly(m, tier),
    used: Number(occupancy[m] || 0),
    extraPaid: Number(extraSeats[m] || 0),
  });

  if (p === "enterprise") {
    for (const m of mods) {
      const cap = 2 + Number(extraSeats[m] || 0);
      if (Number(occupancy[m] || 0) >= cap) pushExtra(m);
    }
  } else {
    const included = includedAccountSeats(p);
    if (accountUsed >= included) {
      for (const m of mods) {
        const extraOn = Math.max(0, Number(occupancy[m] || 0) - included);
        if (Number(extraSeats[m] || 0) <= extraOn) pushExtra(m);
      }
    }
  }

  const monthly = extras.reduce((s, x) => s + x.monthly, 0);
  const includedCount = p === "enterprise" ? 2 : includedAccountSeats(p);
  return {
    allowed: extras.length === 0,
    included: extras.length === 0,
    extras,
    monthly,
    perModuleIncluded: p === "enterprise" ? 2 : includedCount,
    accountUsed,
    label: p === "enterprise"
      ? "Enterprise includes 2 users on each module"
      : `This plan includes ${includedCount} user${includedCount === 1 ? "" : "s"}`,
  };
}

export function occupancyFromRoster({ ownerModules, subs }) {
  const occ = {};
  for (const m of billedModules(ownerModules)) occ[m] = (occ[m] || 0) + 1;
  for (const sub of subs || []) {
    if (String(sub.status || "active").toLowerCase() !== "active") continue;
    let mods = [];
    try { mods = typeof sub.modules === "string" ? JSON.parse(sub.modules || "[]") : (sub.modules || []); } catch { mods = []; }
    for (const m of billedModules(mods)) occ[m] = (occ[m] || 0) + 1;
  }
  return occ;
}
