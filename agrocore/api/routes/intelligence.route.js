import express from "express";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const AIE = require("../../../core/intelligence/AIE.cjs");

const router = express.Router();

function learnAllowed(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || "");
  const local = ip.includes("127.0.0.1") || ip === "::1" || ip.includes("::ffff:127.0.0.1");
  const key = String(req.headers["x-agrocore-learn-key"] || "");
  const expected = process.env.AGROCORE_LEARN_KEY || "agrocore-internal-learn";
  return local || (key && key === expected);
}

function ingestLearnBody(body, fallbackUser) {
  const items = Array.isArray(body?.events) ? body.events : [body];
  let n = 0;
  for (const ev of items) {
    if (!ev || typeof ev !== "object") continue;
    AIE.onActivity({
      source: ev.source || "discora",
      kind: ev.kind || "event",
      user_id: ev.user_id || fallbackUser || null,
      mill_id: ev.mill_id || null,
      species: ev.species || null,
      title: ev.title || ev.question || "",
      text: ev.text || ev.body || ev.answer || ev.content || "",
      metadata: ev.metadata || {}
    });
    n += 1;
  }
  return n;
}

// POST /v1/intelligence/learn  — Discora + internal services (localhost or learn key)
router.post("/learn", (req, res) => {
  try {
    if (!learnAllowed(req)) {
      return res.status(401).json({ ok: false, error: "Learn ingest requires localhost or x-agrocore-learn-key" });
    }
    const n = ingestLearnBody(req.body || {}, null);
    res.json({ ok: true, ingested: n });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// GET /v1/intelligence/status
router.get("/status", (req, res) => {
  try {
    const status = AIE.getStatus();
    res.json({ ok: true, ...status });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// GET /v1/intelligence/insights?species=equine&production=maintenance&body_weight_kg=500
router.get("/insights", (req, res) => {
  try {
    const { species, production, body_weight_kg, intake_pct_bw } = req.query;
    if (!species || !production) {
      return res.status(400).json({ ok: false, message: "species and production required" });
    }
    const data = AIE.getIntelligence({
      species,
      production,
      body_weight_kg: body_weight_kg ? Number(body_weight_kg) : null,
      intake_pct_bw: intake_pct_bw ? Number(intake_pct_bw) : null
    });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /v1/intelligence/predict-outcome
router.post("/predict-outcome", (req, res) => {
  try {
    const { species, production, nutrient_profile } = req.body;
    if (!species || !production || !nutrient_profile) {
      return res.status(400).json({ ok: false, message: "species, production, nutrient_profile required" });
    }
    const prediction = AIE.predictFormulaOutcome({ species, production, nutrient_profile });
    res.json({ ok: true, prediction });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /v1/intelligence/relaxation-suggestions
router.post("/relaxation-suggestions", (req, res) => {
  try {
    const { species, production, failed_constraints } = req.body;
    if (!species || !production || !failed_constraints) {
      return res.status(400).json({ ok: false, message: "species, production, failed_constraints required" });
    }
    const suggestions = AIE.getRelaxationSuggestions({ species, production, failed_constraints });
    res.json({ ok: true, suggestions });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /v1/intelligence/batch-outcome
router.post("/batch-outcome", (req, res) => {
  try {
    AIE.onBatchOutcomeRecorded(req.body);
    res.json({ ok: true, message: "Outcome recorded" });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /v1/intelligence/rebuild
router.post("/rebuild", (req, res) => {
  try {
    const results = AIE.rebuildAllInsights();
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /v1/intelligence/train
router.post("/train", (req, res) => {
  try {
    const { species, production } = req.body;
    const result = AIE.trainModels({ species, production });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
