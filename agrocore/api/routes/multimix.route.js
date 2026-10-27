import express from "express";
import fs from "fs";
import Database from "better-sqlite3";
import { createRequire } from "module";
import { sendMail } from "../../core/email/mailer.js";
import { accountAccessState } from "../lib/account-access.js";

const router = express.Router();
const require = createRequire(import.meta.url);
const {
  runMultimix,
  runMultimixComparison
} = require("../../../core/services/multimix.service.cjs");

const { randomUUID } = require("crypto");
const { getMillDb, runWithMillUser, lookupInboundOwner, retireInboundToken, upsertInboundIndex, currentMillUser, recordInboundPulse } =
  require("../../../core/db/mill/mill.db.cjs");
const { shapeEdgeUpload } = require("../../../core/services/mill/mill.edge.ingest.cjs");

const INBOUND_MODULE_ALIASES = {
  formulation: "nutrix", prices: "nutrix", lab: "nutrix",
  "feed-mill": "milliq", purchaser: "vendorpulse", "farm-pulse": "farmpulse",
};

function usersAccountDbPath() {
  if (process.env.NUTRIX_DB_PATH && fs.existsSync(process.env.NUTRIX_DB_PATH)) return process.env.NUTRIX_DB_PATH;
  const email = process.env.SUPER_ADMIN_EMAIL || "feednutritionmillconsulting@gmail.com";
  const enc = String(email).replace(/@/g, "_at_").replace(/\./g, "_dot_");
  const abs = `/var/www/nutripilot-agrocore/data/users/${enc}/nutrix.db`;
  return fs.existsSync(abs) ? abs : null;
}

/** Mill-edge key works only while that account still has Mill IQ. */
function millIqIngestAllowed(ownerEmail) {
  const email = String(ownerEmail || "").toLowerCase().trim();
  if (!email) return false;
  const dbPath = usersAccountDbPath();
  if (!dbPath) return true;
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    let row;
    try {
      row = db.prepare("SELECT status, modules_granted, module_access FROM np_users WHERE lower(email) = ?").get(email);
    } catch (_col) {
      row = db.prepare("SELECT status, modules_granted FROM np_users WHERE lower(email) = ?").get(email);
      if (row) row.module_access = "{}";
    }
    if (!row) return false;
    const state = accountAccessState(row.status, row.modules_granted, row.module_access);
    if (state.blocked) return false;
    const mods = state.modules.map((k) => INBOUND_MODULE_ALIASES[k] || k);
    return mods.includes("admin") || mods.includes("milliq");
  } catch (_e) {
    return true;
  } finally {
    try { db && db.close(); } catch (_e) {}
  }
}

function refuseStaleIngest(req, millId, owner) {
  try { retireInboundToken(millId, owner); } catch (_e) {}
  recordInboundPulse(millId, { ok: false, error: "Mill IQ ingest is turned off", kind: inboundKind(req), file: inboundFile(req) });
}
function ensureRunsTable(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS multimix_runs (
    id TEXT PRIMARY KEY,
    mill_id TEXT, mill_name TEXT, month_year TEXT,
    created_by TEXT, created_at TEXT,
    status TEXT DEFAULT 'pending',
    summary_json TEXT, totals_json TEXT,
    decided_by TEXT, decided_at TEXT, decision_note TEXT
  )`).run();
}
const ok  = (res, data) => res.json({ ok: true, data });
const rerr = (res, e, status = 500) => res.status(status).json({ ok: false, error: e.message || String(e) });

// ── POST /v1/multimix/runs — submit a run for approval ──
router.post("/v1/multimix/runs", (req, res) => {
  try {
    const b = req.body || {};
    const db = getMillDb(); ensureRunsTable(db);
    const id = randomUUID();
    db.prepare(`INSERT INTO multimix_runs (id, mill_id, mill_name, month_year, created_by, created_at, status, summary_json, totals_json)
      VALUES (?,?,?,?,?,?, 'pending', ?, ?)`).run(
      id, b.mill_id || null, b.mill_name || null, b.month_year || null,
      b.created_by || "nutritionist", new Date().toISOString(),
      JSON.stringify(b.summary || []), JSON.stringify(b.totals || {}));
    ok(res, { id });
  } catch (e) { rerr(res, e); }
});

// ── GET /v1/multimix/runs?status=&mill_id= — list runs (approver queue) ──
router.get("/v1/multimix/runs", (req, res) => {
  try {
    const db = getMillDb(); ensureRunsTable(db);
    const params = [];
    let sql = "SELECT id, mill_id, mill_name, month_year, created_by, created_at, status, totals_json, decided_by, decided_at, decision_note FROM multimix_runs WHERE 1=1";
    if (req.query.status)  { sql += " AND status = ?";  params.push(req.query.status); }
    if (req.query.mill_id) { sql += " AND mill_id = ?"; params.push(req.query.mill_id); }
    sql += " ORDER BY created_at DESC LIMIT 200";
    const rows = db.prepare(sql).all(...params).map(r => ({ ...r, totals: JSON.parse(r.totals_json || "{}") }));
    ok(res, rows);
  } catch (e) { rerr(res, e); }
});

// ── GET /v1/multimix/runs/:id — full run for review ──
router.get("/v1/multimix/runs/:id", (req, res) => {
  try {
    const db = getMillDb(); ensureRunsTable(db);
    const row = db.prepare("SELECT * FROM multimix_runs WHERE id = ?").get(req.params.id);
    if (!row) return rerr(res, new Error("Run not found"), 404);
    ok(res, { ...row, summary: JSON.parse(row.summary_json || "[]"), totals: JSON.parse(row.totals_json || "{}") });
  } catch (e) { rerr(res, e); }
});

// ═══ Universal Batching / PLC export config (per-mill bin·scale·sequence·tolerance + format profile) ═══
function ensureBatchingTables(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS mill_batching_map (
    id TEXT PRIMARY KEY, mill_id TEXT, ingredient_key TEXT,
    ingredient_id TEXT, ingredient_name TEXT,
    bin TEXT, scale TEXT, sequence INTEGER, tolerance_pct REAL, updated_at TEXT
  )`).run();
  db.prepare(`CREATE TABLE IF NOT EXISTS mill_batching_profile (
    mill_id TEXT PRIMARY KEY,
    delimiter TEXT DEFAULT ',', include_header INTEGER DEFAULT 1,
    unit TEXT DEFAULT 'kg', basis_kg REAL DEFAULT 1000, decimals INTEGER DEFAULT 3,
    default_tolerance_pct REAL DEFAULT 1, preset TEXT DEFAULT 'generic', columns TEXT, updated_at TEXT
  )`).run();
  try { db.prepare("ALTER TABLE mill_batching_profile ADD COLUMN preset TEXT DEFAULT 'generic'").run(); } catch (_e) {}
  try { db.prepare("ALTER TABLE mill_batching_profile ADD COLUMN columns TEXT").run(); } catch (_e) {}
  db.prepare(`CREATE TABLE IF NOT EXISTS mill_batching_connector (
    mill_id TEXT PRIMARY KEY, enabled INTEGER DEFAULT 0, url TEXT, method TEXT DEFAULT 'POST',
    auth_header TEXT, format TEXT DEFAULT 'csv', updated_at TEXT
  )`).run();
}

// GET /v1/batching/config/:millId — the mill's map + format profile
router.get("/v1/batching/config/:millId", (req, res) => {
  try {
    const db = getMillDb(); ensureBatchingTables(db);
    const map = db.prepare("SELECT * FROM mill_batching_map WHERE mill_id = ? ORDER BY sequence").all(req.params.millId);
    let profile = db.prepare("SELECT * FROM mill_batching_profile WHERE mill_id = ?").get(req.params.millId);
    if (!profile) profile = { mill_id: req.params.millId, delimiter: ",", include_header: 1, unit: "kg", basis_kg: 1000, decimals: 3, default_tolerance_pct: 1, preset: "generic", columns: null };
    if (profile.columns) { try { profile.columns = JSON.parse(profile.columns); } catch (_e) { profile.columns = null; } }
    let connector = db.prepare("SELECT * FROM mill_batching_connector WHERE mill_id = ?").get(req.params.millId);
    if (!connector) connector = { mill_id: req.params.millId, enabled: 0, url: "", method: "POST", auth_header: "", format: "csv" };
    ok(res, { map, profile, connector });
  } catch (e) { rerr(res, e); }
});

// POST /v1/batching/map/:millId — replace the mill's ingredient map
router.post("/v1/batching/map/:millId", (req, res) => {
  try {
    const rows = Array.isArray(req.body && req.body.map) ? req.body.map : [];
    const db = getMillDb(); ensureBatchingTables(db);
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM mill_batching_map WHERE mill_id = ?").run(req.params.millId);
      const ins = db.prepare(`INSERT INTO mill_batching_map (id, mill_id, ingredient_key, ingredient_id, ingredient_name, bin, scale, sequence, tolerance_pct, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const r of rows) {
        const key = String(r.ingredient_id || r.ingredient_name || "").toLowerCase();
        ins.run(randomUUID(), req.params.millId, key, r.ingredient_id || null, r.ingredient_name || null,
          r.bin || null, r.scale || null, r.sequence != null ? Number(r.sequence) : null,
          r.tolerance_pct != null ? Number(r.tolerance_pct) : null, now);
      }
    });
    tx();
    ok(res, { saved: rows.length });
  } catch (e) { rerr(res, e); }
});

// POST /v1/batching/profile/:millId — save the format profile
router.post("/v1/batching/profile/:millId", (req, res) => {
  try {
    const b = req.body || {};
    const db = getMillDb(); ensureBatchingTables(db);
    const columnsJson = Array.isArray(b.columns) ? JSON.stringify(b.columns) : null;
    db.prepare(`INSERT INTO mill_batching_profile (mill_id, delimiter, include_header, unit, basis_kg, decimals, default_tolerance_pct, preset, columns, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(mill_id) DO UPDATE SET delimiter=excluded.delimiter, include_header=excluded.include_header,
        unit=excluded.unit, basis_kg=excluded.basis_kg, decimals=excluded.decimals,
        default_tolerance_pct=excluded.default_tolerance_pct, preset=excluded.preset, columns=excluded.columns, updated_at=excluded.updated_at`).run(
      req.params.millId, b.delimiter || ",", b.include_header ? 1 : 0, b.unit || "kg",
      Number(b.basis_kg) || 1000, Number(b.decimals) || 3, Number(b.default_tolerance_pct) || 1,
      b.preset || "generic", columnsJson, new Date().toISOString());
    ok(res, { saved: true });
  } catch (e) { rerr(res, e); }
});

// ═══ Central procurement — GROUP ingredient demand rolled up across all plants (read-only oversight) ═══
router.get("/v1/procurement/group-demand", (req, res) => {
  try {
    const db = getMillDb();
    let rows = [];
    try {
      let sql = `SELECT bi.ingredient_id, bi.ingredient_name, b.mill_id, SUM(bi.planned_kg) AS kg
        FROM mill_batch_ingredients bi JOIN mill_batches b ON b.id = bi.batch_id WHERE 1=1`;
      const params = [];
      if (req.query.from) { sql += " AND b.created_at >= ?"; params.push(req.query.from); }
      if (req.query.to)   { sql += " AND b.created_at <= ?"; params.push(req.query.to); }
      sql += " GROUP BY bi.ingredient_id, b.mill_id";
      rows = db.prepare(sql).all(...params);
    } catch (_e) { rows = []; }
    const map = new Map();
    for (const r of rows) {
      const key = r.ingredient_id || r.ingredient_name;
      if (!map.has(key)) map.set(key, { ingredient_id: r.ingredient_id, ingredient_name: r.ingredient_name, total_kg: 0, by_mill: {} });
      const e = map.get(key);
      e.total_kg += r.kg || 0;
      e.by_mill[r.mill_id] = (e.by_mill[r.mill_id] || 0) + (r.kg || 0);
    }
    const data = Array.from(map.values()).sort((a, b) => b.total_kg - a.total_kg);
    ok(res, data);
  } catch (e) { rerr(res, e); }
});

// ═══ Copilot learning store — every Q/A + grounding + feedback (the "AgroCore ML" corpus, grows over time) ═══
function ensureCopilotTable(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS copilot_interactions (
    id TEXT PRIMARY KEY, mill_id TEXT, usr TEXT, question TEXT, answer TEXT,
    grounding TEXT, feedback INTEGER, created_at TEXT
  )`).run();
}
router.post("/v1/copilot/log", (req, res) => {
  try {
    const b = req.body || {};
    const db = getMillDb(); ensureCopilotTable(db);
    const id = randomUUID();
    db.prepare(`INSERT INTO copilot_interactions (id, mill_id, usr, question, answer, grounding, feedback, created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, b.mill_id || null, b.usr || null, b.question || "", b.answer || "", JSON.stringify(b.grounding || {}), null, new Date().toISOString());
    try {
      const AIE = require("../../../core/intelligence/AIE.cjs");
      AIE.onActivity({
        source: 'nutrix', kind: 'ai', user_id: b.usr, mill_id: b.mill_id,
        title: b.question, text: b.answer, metadata: b.grounding || {}, skipMill: true
      });
    } catch (_) {}
    ok(res, { id });
  } catch (e) { rerr(res, e); }
});
router.patch("/v1/copilot/feedback/:id", (req, res) => {
  try {
    const db = getMillDb(); ensureCopilotTable(db);
    db.prepare("UPDATE copilot_interactions SET feedback = ? WHERE id = ?").run(Number(req.body && req.body.feedback) || 0, req.params.id);
    ok(res, { saved: true });
  } catch (e) { rerr(res, e); }
});
// Recent interactions — history + retrieval seed (RAG). Prefer thumbs-up answers.
router.get("/v1/copilot/recent", (req, res) => {
  try {
    const db = getMillDb(); ensureCopilotTable(db);
    const mill = req.query.mill_id;
    const params = [];
    let sql = "SELECT id, question, answer, feedback, created_at FROM copilot_interactions WHERE 1=1";
    if (mill) { sql += " AND (mill_id = ? OR mill_id IS NULL OR mill_id = '')"; params.push(mill); }
    sql += " ORDER BY (feedback = 1) DESC, created_at DESC LIMIT 24";
    const rows = db.prepare(sql).all(...params);
    ok(res, rows);
  } catch (e) { rerr(res, e); }
});

// ═══ Plant-scoped ingredient nutrient profiles (per-batch lab analysis → approved → active per plant) ═══
function ensureIngredientProfileTable(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS mill_ingredient_profiles (
    id TEXT PRIMARY KEY, mill_id TEXT, ingredient_id TEXT, ingredient_name TEXT,
    nutrients_json TEXT, lot_ref TEXT, received_date TEXT,
    status TEXT DEFAULT 'draft', submitted_by TEXT, approved_by TEXT, updated_at TEXT
  )`).run();
}

// GET /v1/ingredient-profiles/:millId?all=1 — approved profiles for a plant (all=drafts too)
router.get("/v1/ingredient-profiles/:millId", (req, res) => {
  try {
    const db = getMillDb(); ensureIngredientProfileTable(db);
    const sql = req.query.all === "1"
      ? "SELECT * FROM mill_ingredient_profiles WHERE mill_id = ? ORDER BY ingredient_name"
      : "SELECT * FROM mill_ingredient_profiles WHERE mill_id = ? AND status = 'approved' ORDER BY ingredient_name";
    const rows = db.prepare(sql).all(req.params.millId).map(r => {
      let nutrients = {}; try { nutrients = JSON.parse(r.nutrients_json || "{}"); } catch (_e) {}
      return { ...r, nutrients };
    });
    ok(res, rows);
  } catch (e) { rerr(res, e); }
});

// POST /v1/ingredient-profiles/:millId — record/update a plant's analyzed profile (draft, by ingredient)
router.post("/v1/ingredient-profiles/:millId", (req, res) => {
  try {
    const b = req.body || {};
    const ingId = String(b.ingredient_id || "").trim();
    if (!ingId) return rerr(res, new Error("ingredient_id is required"), 400);
    const db = getMillDb(); ensureIngredientProfileTable(db);
    const now = new Date().toISOString();
    const existing = db.prepare("SELECT id FROM mill_ingredient_profiles WHERE mill_id = ? AND ingredient_id = ?").get(req.params.millId, ingId);
    if (existing) {
      db.prepare(`UPDATE mill_ingredient_profiles SET ingredient_name=?, nutrients_json=?, lot_ref=?, received_date=?, status='draft', submitted_by=?, updated_at=? WHERE id=?`)
        .run(b.ingredient_name || null, JSON.stringify(b.nutrients || {}), b.lot_ref || null, b.received_date || null, b.submitted_by || "lab", now, existing.id);
    } else {
      db.prepare(`INSERT INTO mill_ingredient_profiles (id, mill_id, ingredient_id, ingredient_name, nutrients_json, lot_ref, received_date, status, submitted_by, updated_at)
        VALUES (?,?,?,?,?,?,?, 'draft', ?, ?)`).run(randomUUID(), req.params.millId, ingId, b.ingredient_name || null, JSON.stringify(b.nutrients || {}), b.lot_ref || null, b.received_date || null, b.submitted_by || "lab", now);
    }
    ok(res, { saved: true });
  } catch (e) { rerr(res, e); }
});

// PATCH /v1/ingredient-profiles/:millId/:ingredientId/approve — make the analyzed profile active for this plant
router.patch("/v1/ingredient-profiles/:millId/:ingredientId/approve", (req, res) => {
  try {
    const db = getMillDb(); ensureIngredientProfileTable(db);
    const r = db.prepare("UPDATE mill_ingredient_profiles SET status='approved', approved_by=?, updated_at=? WHERE mill_id=? AND ingredient_id=?")
      .run((req.body && req.body.approved_by) || "nutritionist", new Date().toISOString(), req.params.millId, req.params.ingredientId);
    if (!r.changes) return rerr(res, new Error("Profile not found"), 404);
    ok(res, { approved: true });
  } catch (e) { rerr(res, e); }
});

// DELETE /v1/ingredient-profiles/:millId/:ingredientId — remove a plant profile (revert to book values)
router.delete("/v1/ingredient-profiles/:millId/:ingredientId", (req, res) => {
  try {
    const db = getMillDb(); ensureIngredientProfileTable(db);
    db.prepare("DELETE FROM mill_ingredient_profiles WHERE mill_id=? AND ingredient_id=?").run(req.params.millId, req.params.ingredientId);
    ok(res, { deleted: true });
  } catch (e) { rerr(res, e); }
});

// ═══ Finished-feed lab analysis vs formulated nutrient profile (nutrient deviation) ═══
function ensureFeedAnalysisTable(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS mill_batch_feed_analysis (
    batch_id TEXT PRIMARY KEY, nutrients_json TEXT, lab_ref TEXT, analyzed_by TEXT, submitted_at TEXT
  )`).run();
}

// POST /v1/batch-analysis/:batchId — submit lab-analyzed nutrients for the manufactured feed
router.post("/v1/batch-analysis/:batchId", (req, res) => {
  try {
    const b = req.body || {};
    const db = getMillDb(); ensureFeedAnalysisTable(db);
    db.prepare(`INSERT INTO mill_batch_feed_analysis (batch_id, nutrients_json, lab_ref, analyzed_by, submitted_at)
      VALUES (?,?,?,?,?)
      ON CONFLICT(batch_id) DO UPDATE SET nutrients_json=excluded.nutrients_json, lab_ref=excluded.lab_ref,
        analyzed_by=excluded.analyzed_by, submitted_at=excluded.submitted_at`).run(
      req.params.batchId, JSON.stringify(b.nutrients || {}), b.lab_ref || null, b.analyzed_by || null, new Date().toISOString());
    ok(res, { saved: true });
  } catch (e) { rerr(res, e); }
});

// POST /v1/inbound/feed-analysis/:millId?token= — lab system posts a finished-feed COA (no manual entry)
router.post("/v1/inbound/feed-analysis/:millId", (req, res) => {
  withInboundUser(req, res, () => {
  try {
    const db = getMillDb(); ensureInboundTable(db); ensureFeedAnalysisTable(db);
    const shaped = shapeEdgeUpload("lab", req.body, inboundFile(req) || "");
    if (shaped.error) return rerr(res, new Error(shaped.error), 400);
    const b = shaped.body || {};
    const batchNumber = req.query.batch || b.batch_number;
    const nutrients = b.nutrients || {};
    if (!batchNumber) { return rerr(res, new Error("No batch identifier in report"), 400); }
    if (!nutrients || typeof nutrients !== "object" || !Object.keys(nutrients).length) { return rerr(res, new Error("No nutrients in report"), 400); }
    const batch = db.prepare("SELECT id FROM mill_batches WHERE mill_id = ? AND batch_number = ?").get(req.params.millId, String(batchNumber));
    if (!batch) { return rerr(res, new Error(`No batch found for "${batchNumber}" at this mill`), 404); }
    const clean = {};
    for (const k of Object.keys(nutrients)) { const v = Number(nutrients[k]); if (!Number.isNaN(v)) clean[k] = v; }
    db.prepare(`INSERT INTO mill_batch_feed_analysis (batch_id, nutrients_json, lab_ref, analyzed_by, submitted_at)
      VALUES (?,?,?,?,?)
      ON CONFLICT(batch_id) DO UPDATE SET nutrients_json=excluded.nutrients_json, lab_ref=excluded.lab_ref, analyzed_by=excluded.analyzed_by, submitted_at=excluded.submitted_at`)
      .run(batch.id, JSON.stringify(clean), b.lab_ref || null, b.analyzed_by || "lab-system", new Date().toISOString());
    const protein = clean.cp != null ? clean.cp : (clean.protein != null ? clean.protein : (clean.protein_pct != null ? clean.protein_pct : null));
    const moisture = clean.moisture != null ? clean.moisture : (clean.moisture_pct != null ? clean.moisture_pct : null);
    if (protein != null || moisture != null) {
      try {
        const { recordQcResult } = require("../../../core/services/mill/mill.qc.service.cjs");
        const existing = db.prepare("SELECT * FROM mill_qc_results WHERE batch_id = ?").get(batch.id);
        recordQcResult({
          batch_id: batch.id,
          moisture_pct: moisture ?? existing?.moisture_pct ?? null,
          pdi_pct: existing?.pdi_pct ?? null,
          fines_pct: existing?.fines_pct ?? null,
          protein_pct: protein ?? existing?.protein_pct ?? null,
          particle_size_mm: existing?.particle_size_mm ?? null,
          notes: b.lab_ref || inboundFile(req) || "mill-edge lab CoA",
          reviewed_by: b.analyzed_by || "mill-edge",
        });
      } catch (_e) { /* CoA still saved */ }
    }
    recordInboundPulse(req.params.millId, { ok: true, kind: "lab", file: inboundFile(req) });
    ok(res, { batch_id: batch.id, batch_number: batchNumber, nutrients_recorded: Object.keys(clean).length, message: "Finished-feed COA ingested — nutrient deviation updated." });
  } catch (e) {
    recordInboundPulse(req.params.millId, { ok: false, error: e.message, kind: "lab", file: inboundFile(req) });
    rerr(res, e);
  }
  });
});

// GET /v1/batch-analysis/:batchId — submitted lab results + the batch's FORMULATED profile (for deviation)
router.get("/v1/batch-analysis/:batchId", (req, res) => {
  try {
    const db = getMillDb(); ensureFeedAnalysisTable(db);
    const a = db.prepare("SELECT * FROM mill_batch_feed_analysis WHERE batch_id = ?").get(req.params.batchId);
    const batch = db.prepare("SELECT formula_snapshot_id FROM mill_batches WHERE id = ?").get(req.params.batchId);
    let formulated = {};
    if (batch && batch.formula_snapshot_id) {
      const snap = db.prepare("SELECT nutrients_json FROM mill_formula_snapshots WHERE id = ?").get(batch.formula_snapshot_id);
      if (snap && snap.nutrients_json) { try { formulated = JSON.parse(snap.nutrients_json); } catch (_e) {} }
    }
    let analysis = null;
    if (a) { analysis = { lab_ref: a.lab_ref, analyzed_by: a.analyzed_by, submitted_at: a.submitted_at, nutrients: {} }; try { analysis.nutrients = JSON.parse(a.nutrients_json || "{}"); } catch (_e) {} }
    ok(res, { analysis, formulated });
  } catch (e) { rerr(res, e); }
});

function getSharedMillDb() {
  return getMillDb();
}

function inboundKind(req) {
  const p = String(req.path || req.url || "");
  if (p.includes("weighbridge")) return "weighbridge";
  if (p.includes("dispatch")) return "dispatch";
  if (p.includes("feed-analysis")) return "lab";
  if (p.includes("ping")) return "ping";
  return "batch";
}

function inboundFile(req) {
  return req.query.filename || req.headers["x-filename"] || null;
}

function withInboundUser(req, res, fn) {
  const token = req.query.token || req.headers["x-ingest-token"];
  const millId = req.params.millId;
  const owner = lookupInboundOwner(millId, token);
  if (!owner) {
    recordInboundPulse(millId, { ok: false, error: "Invalid or missing ingest token", kind: inboundKind(req), file: inboundFile(req) });
    return rerr(res, new Error("Invalid or missing ingest token"), 401);
  }
  if (!millIqIngestAllowed(owner)) {
    refuseStaleIngest(req, millId, owner);
    return rerr(res, new Error("Mill IQ ingest is turned off for this mill"), 401);
  }
  return runWithMillUser(owner, fn);
}

// POST /v1/inbound/ping/:millId?token= — mill-edge heartbeat (no batch file)
router.post("/v1/inbound/ping/:millId", (req, res) => {
  withInboundUser(req, res, () => {
    recordInboundPulse(req.params.millId, { ok: true, kind: "ping", file: inboundFile(req) || "mill-edge-start" });
    ok(res, { mill_id: req.params.millId, ping: true });
  });
});

router.post("/v1/inbound/process/:millId", (req, res) => {
  withInboundUser(req, res, () => {
    try {
      const { recordProcessQc } = require("../../../core/services/mill/mill.floor.service.cjs");
      const b0 = req.body || {};
      const shaped = shapeEdgeUpload("process", b0, inboundFile(req) || "");
      if (shaped.error) return rerr(res, new Error(shaped.error), 400);
      const b = shaped.body || {};
      const millId = req.params.millId;
      const db = getMillDb();
      let batchKey = b.batch_id || b.batch_number || null;
      let batchRow = null;
      if (batchKey) {
        batchRow = db.prepare("SELECT id FROM mill_batches WHERE mill_id = ? AND id = ?").get(millId, String(batchKey))
          || db.prepare("SELECT id FROM mill_batches WHERE mill_id = ? AND batch_number = ?").get(millId, String(batchKey));
      }
      const r = recordProcessQc({
        mill_id: millId,
        batch_id: batchRow?.id || batchKey,
        grind_size_mm: b.grind_size_mm,
        conditioner_temp: b.conditioner_temp,
        pellet_temp: b.pellet_temp,
        pdi_pct: b.pdi_pct,
        kwh_per_ton: b.kwh_per_ton,
        notes: b.notes || inboundFile(req),
      });
      if (batchRow?.id && (b.pdi_pct != null || b.grind_size_mm != null || b.moisture_pct != null || b.fines_pct != null || b.protein_pct != null)) {
        try {
          const { recordQcResult } = require("../../../core/services/mill/mill.qc.service.cjs");
          recordQcResult({
            batch_id: batchRow.id,
            moisture_pct: b.moisture_pct ?? null,
            pdi_pct: b.pdi_pct ?? null,
            fines_pct: b.fines_pct ?? null,
            protein_pct: b.protein_pct ?? null,
            particle_size_mm: b.grind_size_mm ?? null,
            notes: b.notes || inboundFile(req) || "mill-edge process QC",
            reviewed_by: "mill-edge",
          });
        } catch (_e) { /* process QC still saved */ }
      }
      recordInboundPulse(millId, { ok: true, kind: "process", file: inboundFile(req) });
      ok(res, r);
    } catch (e) {
      recordInboundPulse(req.params.millId, { ok: false, error: e.message, kind: "process", file: inboundFile(req) });
      rerr(res, e);
    }
  });
});

// ═══ Inbound batch-report adapter (mill's batching system → actuals → deviation, zero manual entry) ═══
function ensureInboundTable(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS mill_inbound_map (
    mill_id TEXT PRIMARY KEY, format TEXT DEFAULT 'json',
    batch_field TEXT DEFAULT 'batch_number', lines_path TEXT DEFAULT 'ingredients',
    code_field TEXT DEFAULT 'code', actual_field TEXT DEFAULT 'actual_kg', unit_field TEXT,
    ingest_token TEXT, updated_at TEXT
  )`).run();
}
function getPath(obj, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// GET /v1/inbound/config/:millId — mapping + webhook URL + token (auto-creates defaults)
router.get("/v1/inbound/config/:millId", (req, res) => {
  try {
    const db = getSharedMillDb(); ensureInboundTable(db);
    let cfg = db.prepare("SELECT * FROM mill_inbound_map WHERE mill_id = ?").get(req.params.millId);
    if (!cfg) {
      cfg = { mill_id: req.params.millId, format: "json", batch_field: "batch_number", lines_path: "ingredients", code_field: "code", actual_field: "actual_kg", unit_field: "", ingest_token: randomUUID().replace(/-/g, "").slice(0, 20), updated_at: new Date().toISOString() };
      db.prepare(`INSERT INTO mill_inbound_map (mill_id, format, batch_field, lines_path, code_field, actual_field, unit_field, ingest_token, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(cfg.mill_id, cfg.format, cfg.batch_field, cfg.lines_path, cfg.code_field, cfg.actual_field, cfg.unit_field, cfg.ingest_token, cfg.updated_at);
    }
    upsertInboundIndex(req.params.millId, currentMillUser(), cfg.ingest_token);
    ok(res, {
      config: cfg,
      webhook_url: `https://agrocoreprime.com/v1/inbound/batch/${req.params.millId}?token=${cfg.ingest_token}`,
      mill_edge: "Mill-edge keeps mill weight unit (no kg conversion). Drop batch files in the watch folder; lab/CoA in lab/; weighbridge receipts in weighbridge/; load-out in dispatch/.",
    });
  } catch (e) { rerr(res, e); }
});

// POST /v1/inbound/config/:millId — save the inbound mapping
router.post("/v1/inbound/config/:millId", (req, res) => {
  try {
    const b = req.body || {};
    const db = getSharedMillDb(); ensureInboundTable(db);
    const existing = db.prepare("SELECT ingest_token FROM mill_inbound_map WHERE mill_id = ?").get(req.params.millId);
    const token = (existing && existing.ingest_token) || randomUUID().replace(/-/g, "").slice(0, 20);
    db.prepare(`INSERT INTO mill_inbound_map (mill_id, format, batch_field, lines_path, code_field, actual_field, unit_field, ingest_token, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(mill_id) DO UPDATE SET format=excluded.format, batch_field=excluded.batch_field, lines_path=excluded.lines_path,
        code_field=excluded.code_field, actual_field=excluded.actual_field, unit_field=excluded.unit_field, updated_at=excluded.updated_at`).run(
      req.params.millId, b.format || "json", b.batch_field || "batch_number", b.lines_path || "ingredients",
      b.code_field || "code", b.actual_field || "actual_kg", b.unit_field || "", token, new Date().toISOString());
    upsertInboundIndex(req.params.millId, currentMillUser(), token);
    ok(res, { saved: true, ingest_token: token });
  } catch (e) { rerr(res, e); }
});

function toKg(v, u) {
  const n = Number(v) || 0;
  const uu = String(u || "kg").toLowerCase();
  if (uu === "lb" || uu === "lbs") return n * 0.453592;
  if (uu === "g") return n / 1000;
  if (uu === "t" || uu === "ton" || uu === "mt") return n * 1000;
  return n;
}

function splitCsvLine(line, delim) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { q = !q; continue; }
    if (!q && ch === delim) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function headerKey(h) {
  return String(h || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function parseCsvBatchReport(text, cfg, filename) {
  const raw = String(text || "").replace(/^\uFEFF/, "").replace(/\r/g, "");
  const rowsText = raw.split("\n").map(l => l.trim()).filter(Boolean);
  if (!rowsText.length) return { error: "Empty CSV" };
  const first = rowsText[0];
  const delim = first.includes("\t") && !first.includes(",") ? "\t" : (first.includes(";") ? ";" : ",");
  const headers = splitCsvLine(first, delim).map(headerKey);
  const col = (...aliases) => {
    for (const a of aliases) {
      const i = headers.indexOf(headerKey(a));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iBatch = col(cfg.batch_field, "batch_number", "batch", "batch_id", "lot", "lot_no", "lotno", "mix", "mix_no", "mixno", "job", "ticket", "ticket_no");
  const iFormula = col("formula_name", "formula", "recipe", "diet", "product", "feed", "ration");
  const iCode = col(cfg.code_field, "code", "ingredient_id", "ingredient_code", "item", "sku", "rm_code", "raw_code", "component", "ing_code", "mat_code");
  const iName = col("name", "ingredient_name", "ingredient", "material", "raw_material", "description", "item_name");
  const iActual = col(cfg.actual_field, "actual_kg", "actual", "actual_weight", "dosed", "weighed", "qty", "quantity", "weight", "wt", "act_qty", "used");
  const iPlan = col("planned_kg", "target", "target_kg", "setpoint", "recipe_kg", "set", "req", "required", "plan");
  const iUnit = col(cfg.unit_field, "unit", "uom", "units");
  if (iActual < 0 || (iCode < 0 && iName < 0)) {
    return { error: "CSV needs an actual-weight column and an ingredient code or name column" };
  }
  const rows = [];
  let batchNumber = null;
  let formulaName = null;
  for (let r = 1; r < rowsText.length; r++) {
    const cells = splitCsvLine(rowsText[r], delim);
    if (iBatch >= 0 && cells[iBatch]) batchNumber = cells[iBatch];
    if (iFormula >= 0 && cells[iFormula]) formulaName = cells[iFormula];
    rows.push({
      code: iCode >= 0 ? cells[iCode] : "",
      name: iName >= 0 ? cells[iName] : "",
      planned_kg: iPlan >= 0 && cells[iPlan] !== "" ? Number(String(cells[iPlan]).replace(/,/g, "")) : null,
      actual_kg: Number(String(cells[iActual]).replace(/,/g, "")),
      unit: iUnit >= 0 && cells[iUnit] ? cells[iUnit] : null,
    });
  }
  if (!batchNumber && filename) batchNumber = String(filename).replace(/\.[^.]+$/, "");
  return { batchNumber, formulaName, rows };
}

// POST /v1/inbound/batch/:millId?token= — mill-edge / PLC posts a completed-batch report.
router.post("/v1/inbound/batch/:millId", (req, res) => {
  withInboundUser(req, res, () => {
  try {
    const db = getMillDb(); ensureInboundTable(db);
    const cfg = db.prepare("SELECT * FROM mill_inbound_map WHERE mill_id = ?").get(req.params.millId);
    if (!cfg) { return rerr(res, new Error("Invalid or missing ingest token"), 401); }

    const filename = String(req.query.filename || req.headers["x-filename"] || "");
    let batchNumber = req.query.batch || null;
    let formulaName = req.query.formula || null;
    let mapped = [];

    let body = req.body;
    if (typeof body !== "object" || body === null) {
      const shaped = shapeEdgeUpload("batch", body, filename);
      if (shaped.error) return rerr(res, new Error(shaped.error), 400);
      body = shaped.body;
    }
    if (typeof body === "string") {
      const parsed = parseCsvBatchReport(body, cfg, filename);
      if (parsed.error) return rerr(res, new Error(parsed.error), 400);
      batchNumber = batchNumber || parsed.batchNumber;
      formulaName = formulaName || parsed.formulaName;
      mapped = parsed.rows;
    } else {
      const obj = body || {};
      if (Array.isArray(obj.actuals) && (obj.batch_number || batchNumber)) {
        batchNumber = obj.batch_number || batchNumber;
        formulaName = obj.formula_name || formulaName;
        mapped = obj.actuals.map(a => ({
          code: a.ingredient_id || a.code,
          name: a.ingredient_name || a.name,
          planned_kg: a.planned_kg != null ? Number(a.planned_kg) : (a.planned != null ? Number(a.planned) : null),
          actual_kg: Number(a.actual_kg ?? a.actual),
          unit: a.unit || obj.unit || null,
        }));
      } else {
        batchNumber = batchNumber || getPath(obj, cfg.batch_field);
        formulaName = formulaName || obj.formula_name || getPath(obj, "formula_name");
        const arr = getPath(obj, cfg.lines_path);
        if (!Array.isArray(arr)) return rerr(res, new Error(`Could not find the ingredient lines array at "${cfg.lines_path}"`), 400);
        mapped = arr.map(l => ({
          code: l[cfg.code_field],
          name: l.name || l.ingredient_name || l[cfg.code_field],
          planned_kg: (l.planned_kg != null || l.target != null) ? Number(l.planned_kg ?? l.target) : null,
          actual_kg: Number(l[cfg.actual_field]),
          unit: (cfg.unit_field && l[cfg.unit_field]) || l.unit || obj.unit || null,
        }));
      }
    }

    if (!batchNumber) return rerr(res, new Error("No batch identifier in report (set batch_number or filename)"), 400);

    const svc = require("../../../core/services/mill/mill.batch.service.cjs");
    const r1 = svc.ingestPlcBatch({
      mill_id: req.params.millId,
      batch_number: String(batchNumber),
      formula_name: formulaName,
      lines: mapped,
      source: "file_import",
      operator_id: (typeof req.body === "object" && req.body?.operator_id) || null,
      weight_unit: (typeof req.body === "object" && req.body?.unit) || mapped[0]?.unit || null,
    });
    if (!r1.ok) return rerr(res, new Error(r1.error || "Ingest failed"), 400);

    const dev = require("../../../core/services/mill/mill.deviation.service.cjs");
    const inv = require("../../../core/services/mill/mill.inventory.service.cjs");
    let deviation = {};
    try { deviation = dev.calculateBatchDeviation(r1.batch_id) || {}; } catch (_e) {}
    try { inv.recordUsageFromBatch(r1.batch_id, null); } catch (_e) {}
    recordInboundPulse(req.params.millId, { ok: true, kind: "batch", file: filename });
    ok(res, {
      batch_id: r1.batch_id, batch_number: r1.batch_number, actuals_recorded: r1.actuals,
      weight_unit: r1.weight_unit,
      deviation: { status: deviation.overall_status, cost_impact: deviation.total_cost_impact, flagged: deviation.flagged_count },
      message: "PLC report ingested in mill weight unit (not converted to kg).",
    });
  } catch (e) {
    recordInboundPulse(req.params.millId, { ok: false, error: e.message, kind: "batch", file: inboundFile(req) });
    rerr(res, e);
  }
  });
});

function inboundAuth(req) {
  const token = req.query.token || req.headers["x-ingest-token"];
  const owner = lookupInboundOwner(req.params.millId, token);
  if (!owner) {
    recordInboundPulse(req.params.millId, { ok: false, error: "Invalid or missing ingest token", kind: inboundKind(req), file: inboundFile(req) });
    return { ok: false, error: "Invalid or missing ingest token" };
  }
  if (!millIqIngestAllowed(owner)) {
    refuseStaleIngest(req, req.params.millId, owner);
    return { ok: false, error: "Mill IQ ingest is turned off for this mill" };
  }
  return { ok: true, owner };
}

// POST /v1/inbound/weighbridge/:millId — mill-edge posts a truck receipt into Mill IQ weighbridge
router.post("/v1/inbound/weighbridge/:millId", (req, res) => {
  try {
    const auth = inboundAuth(req);
    if (!auth.ok) return rerr(res, new Error(auth.error), 401);
    runWithMillUser(auth.owner, () => {
    const shaped = shapeEdgeUpload("weighbridge", req.body, inboundFile(req) || "");
    if (shaped.error) return rerr(res, new Error(shaped.error), 400);
    const b = shaped.body || {};
    const wb = require("../../../core/services/mill/mill.weighbridge.service.cjs");
    const result = wb.recordWeighbridgeReceipt({
      mill_id: req.params.millId,
      ingredient_id: b.ingredient_id || b.code,
      ingredient_name: b.ingredient_name || b.name || b.ingredient_id,
      supplier_id: b.supplier_id || null,
      supplier_name: b.supplier_name || null,
      vehicle_id: b.vehicle_id || null,
      driver_name: b.driver_name || null,
      gross_weight: Number(b.gross_weight),
      tare_weight: Number(b.tare_weight),
      recorded_unit: b.recorded_unit || b.unit || null,
      moisture_pct: b.moisture_pct != null ? Number(b.moisture_pct) : null,
      protein_pct: b.protein_pct != null ? Number(b.protein_pct) : null,
      storage_bin: b.storage_bin || null,
      receipt_date: b.receipt_date || null,
      received_by: b.received_by || "mill-edge",
      notes: b.notes || "mill-edge",
      receipt_number: b.receipt_number || null,
      lot_number: b.lot_number || null,
      photo_data: b.photo_data || null,
      photo_path: b.photo_path || null,
      price_per_unit: b.price_per_unit != null ? Number(b.price_per_unit) : null,
      currency: b.currency || "USD",
    });
    if (!result.ok) return rerr(res, new Error(result.error || "Weighbridge ingest failed"), 400);
    recordInboundPulse(req.params.millId, { ok: true, kind: "weighbridge", file: inboundFile(req) });
    ok(res, result);
    });
  } catch (e) {
    recordInboundPulse(req.params.millId, { ok: false, error: e.message, kind: "weighbridge", file: inboundFile(req) });
    rerr(res, e);
  }
});

// POST /v1/inbound/dispatch/:millId — mill-edge posts load-out / farm delivery
router.post("/v1/inbound/dispatch/:millId", (req, res) => {
  try {
    const auth = inboundAuth(req);
    if (!auth.ok) return rerr(res, new Error(auth.error), 401);
    runWithMillUser(auth.owner, () => {
    const shaped = shapeEdgeUpload("dispatch", req.body, inboundFile(req) || "");
    if (shaped.error) return rerr(res, new Error(shaped.error), 400);
    const b = shaped.body || {};
    const db = getSharedMillDb();
    const batchNumber = b.batch_number || req.query.batch;
    if (!batchNumber) return rerr(res, new Error("batch_number required"), 400);
    const batch = db.prepare("SELECT id FROM mill_batches WHERE mill_id = ? AND batch_number = ?").get(req.params.millId, String(batchNumber));
    if (!batch) return rerr(res, new Error(`No batch "${batchNumber}" at this mill`), 404);
    const disp = require("../../../core/services/mill/mill.dispatch.service.cjs");
    const result = disp.createDispatchRecord({
      batch_id: batch.id,
      mill_id: req.params.millId,
      customer_id: b.customer_id || null,
      farm_id: b.farm_id || null,
      customer_name: b.customer_name || b.farm_name || "Farm",
      quantity_tons: Number(b.quantity_tons ?? b.quantity ?? b.mill_mass ?? 0),
      mill_mass: b.mill_mass != null ? Number(b.mill_mass) : null,
      leftover_mass: b.leftover_mass != null ? Number(b.leftover_mass) : null,
      silo_bin: b.silo_bin || b.bin || null,
      vehicle_id: b.vehicle_id || null,
      driver_name: b.driver_name || null,
      notes: b.notes || "mill-edge",
    });
    if (!result.ok) return rerr(res, new Error(result.error || "Dispatch ingest failed"), 400);
    recordInboundPulse(req.params.millId, { ok: true, kind: "dispatch", file: inboundFile(req) });
    ok(res, result);
    });
  } catch (e) {
    recordInboundPulse(req.params.millId, { ok: false, error: e.message, kind: "dispatch", file: inboundFile(req) });
    rerr(res, e);
  }
});

// GET /v1/batching/stock/:millId — current available stock per ingredient (approved receipts → inventory)
router.get("/v1/batching/stock/:millId", (req, res) => {
  try {
    const db = getMillDb();
    let rows = [];
    try {
      rows = db.prepare(`SELECT ingredient_id, ingredient_name, record_date, opening, received, used, closing
        FROM mill_inventory WHERE mill_id = ?`).all(req.params.millId);
    } catch (_e) { rows = []; }
    // Keep only the most recent record per ingredient, then compute current stock.
    const latest = new Map();
    for (const r of rows) {
      const key = r.ingredient_id || r.ingredient_name;
      const prev = latest.get(key);
      if (!prev || String(r.record_date) > String(prev.record_date)) latest.set(key, r);
    }
    const data = Array.from(latest.values()).map(r => {
      const available = (r.closing != null && r.closing > 0)
        ? r.closing
        : ((r.opening || 0) + (r.received || 0) - (r.used || 0));
      return {
        ingredient_id: r.ingredient_id, ingredient_name: r.ingredient_name,
        available,
        available_kg: available,
      };
    }).filter(x => x.available > 0);
    ok(res, data);
  } catch (e) { rerr(res, e); }
});

// POST /v1/batching/connector/:millId — save the MES/PLC push connector
router.post("/v1/batching/connector/:millId", (req, res) => {
  try {
    const b = req.body || {};
    const db = getMillDb(); ensureBatchingTables(db);
    db.prepare(`INSERT INTO mill_batching_connector (mill_id, enabled, url, method, auth_header, format, updated_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(mill_id) DO UPDATE SET enabled=excluded.enabled, url=excluded.url, method=excluded.method,
        auth_header=excluded.auth_header, format=excluded.format, updated_at=excluded.updated_at`).run(
      req.params.millId, b.enabled ? 1 : 0, b.url || "", b.method || "POST", b.auth_header || "", b.format || "csv", new Date().toISOString());
    ok(res, { saved: true });
  } catch (e) { rerr(res, e); }
});

// POST /v1/batching/push/:millId — relay a built batching payload to the mill's MES endpoint
router.post("/v1/batching/push/:millId", async (req, res) => {
  try {
    const db = getMillDb(); ensureBatchingTables(db);
    const c = db.prepare("SELECT * FROM mill_batching_connector WHERE mill_id = ?").get(req.params.millId);
    if (!c || !c.enabled || !c.url) return rerr(res, new Error("No MES connector is configured/enabled for this mill."), 400);
    if (typeof fetch !== "function") return rerr(res, new Error("Server fetch unavailable (Node < 18)."), 500);
    const headers = { "Content-Type": req.body.content_type || "text/csv" };
    if (c.auth_header) {
      const i = c.auth_header.indexOf(":");
      if (i > 0) headers[c.auth_header.slice(0, i).trim()] = c.auth_header.slice(i + 1).trim();
      else headers["Authorization"] = c.auth_header;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    let r, text = "";
    try {
      r = await fetch(c.url, { method: c.method || "POST", headers, body: req.body.content || "", signal: ctrl.signal });
      text = await r.text().catch(() => "");
    } finally { clearTimeout(t); }
    ok(res, { http_status: r.status, delivered: r.ok, response: String(text).slice(0, 500) });
  } catch (e) { rerr(res, e); }
});

// ── POST /v1/multimix/runs/:id/notify — email the approval link to the authority ──
router.post("/v1/multimix/runs/:id/notify", async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || "").trim();
    if (!email) return rerr(res, new Error("email is required"), 400);
    const db = getMillDb(); ensureRunsTable(db);
    const run = db.prepare("SELECT id, mill_name, month_year, created_by FROM multimix_runs WHERE id = ?").get(req.params.id);
    if (!run) { return rerr(res, new Error("Run not found"), 404); }
    try { db.prepare("ALTER TABLE multimix_runs ADD COLUMN approver_email TEXT").run(); } catch (_e) {}
    db.prepare("UPDATE multimix_runs SET approver_email = ? WHERE id = ?").run(email, run.id);
    const link = `https://agrocoreprime.com/multimix-approval/${run.id}`;
    const subject = `Multimix approval needed — ${run.mill_name || "plant"} ${run.month_year || ""}`;
    const text = `A Multimix optimization run is awaiting your approval.\n\nPlant: ${run.mill_name || "-"}\nPeriod: ${run.month_year || "-"}\nSubmitted by: ${run.created_by || "-"}\n\nReview and approve/reject here:\n${link}\n`;
    const html = `<p>A Multimix optimization run is awaiting your approval.</p>
      <p><b>Plant:</b> ${run.mill_name || "-"}<br><b>Period:</b> ${run.month_year || "-"}<br><b>Submitted by:</b> ${run.created_by || "-"}</p>
      <p><a href="${link}" style="background:#2f9e54;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Review &amp; decide</a></p>
      <p>${link}</p>`;
    const r = await sendMail({ to: email, subject, text, html });
    ok(res, { emailed: r.sent, skipped: r.skipped || null, link });
  } catch (e) { rerr(res, e); }
});

// ── PATCH /v1/multimix/runs/:id/decision — approve / reject ──
router.patch("/v1/multimix/runs/:id/decision", (req, res) => {
  try {
    const b = req.body || {};
    const status = b.status === "approved" ? "approved" : (b.status === "rejected" ? "rejected" : null);
    if (!status) return rerr(res, new Error("status must be approved or rejected"), 400);
    const db = getMillDb(); ensureRunsTable(db);
    const r = db.prepare("UPDATE multimix_runs SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?")
      .run(status, b.decided_by || "authority", new Date().toISOString(), b.note || null, req.params.id);
    if (!r.changes) return rerr(res, new Error("Run not found"), 404);
    ok(res, { id: req.params.id, status });
  } catch (e) { rerr(res, e); }
});

router.post("/v1/multimix", async (req, res) => {
  try {
    const result = await runMultimix(req.body || {});

    if (!result || typeof result !== "object") {
      return res.status(500).json({
        status: "error",
        message: "Multimix service returned an invalid response",
        meta: {
          engine: "AgroCore",
          module: "multimix_v1",
          stage: "route_invalid_service_response",
          timestamp_utc: new Date().toISOString()
        }
      });
    }

    return res.status(result.http_status || 200).json(result.payload);
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: err?.message || "Multimix route failed",
      meta: {
        engine: "AgroCore",
        module: "multimix_v1",
        stage: "route_runtime_error",
        timestamp_utc: new Date().toISOString()
      }
    });
  }
});

router.post("/v1/multimix/compare", async (req, res) => {
  try {
    const result = await runMultimixComparison(req.body || {});

    if (!result || typeof result !== "object") {
      return res.status(500).json({
        status: "error",
        message: "Multimix comparison service returned an invalid response",
        meta: {
          engine: "AgroCore",
          module: "multimix_compare_v1",
          stage: "route_invalid_service_response",
          timestamp_utc: new Date().toISOString()
        }
      });
    }

    return res.status(result.http_status || 200).json(result.payload);
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: err?.message || "Multimix comparison route failed",
      meta: {
        engine: "AgroCore",
        module: "multimix_compare_v1",
        stage: "route_runtime_error",
        timestamp_utc: new Date().toISOString()
      }
    });
  }
});

export default router;
