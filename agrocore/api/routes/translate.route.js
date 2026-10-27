import express from "express";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  translateBatch,
  detectLanguage,
  translatePreservingCodeBlocks,
  resolveLanguageCode,
  languageName
} = require("../../../core/services/translate.service.cjs");

const router = express.Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "translate", provider: "google-translate-api-x" });
});

// POST /v1/translate  { text, target, source? }
router.post("/", async (req, res) => {
  try {
    const text = req.body?.text;
    const target = await resolveLanguageCode(req.body?.target);
    const source = req.body?.source ? (await resolveLanguageCode(req.body.source)) || "auto" : "auto";

    if (!text || !target) {
      return res.status(400).json({ ok: false, error: "text and target are required" });
    }

    const result = await translatePreservingCodeBlocks(text, target, source);
    res.json({ ok: true, text: result.text, source: result.from, target, target_name: languageName(target) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// POST /v1/translate/batch  { texts: string[], target, source? }
router.post("/batch", async (req, res) => {
  try {
    const texts = req.body?.texts;
    const target = await resolveLanguageCode(req.body?.target);
    const source = req.body?.source ? (await resolveLanguageCode(req.body.source)) || "auto" : "auto";

    if (!Array.isArray(texts) || !texts.length || !target) {
      return res.status(400).json({ ok: false, error: "texts (array) and target are required" });
    }
    if (texts.length > 500) {
      return res.status(400).json({ ok: false, error: "too many texts (max 500)" });
    }

    const out = await translateBatch(texts, target, source);
    res.json({ ok: true, texts: out, target, target_name: languageName(target) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// POST /v1/translate/detect  { text }
router.post("/detect", async (req, res) => {
  try {
    const text = req.body?.text;
    if (!text) return res.status(400).json({ ok: false, error: "text is required" });
    const language = await detectLanguage(text);
    res.json({ ok: true, language, language_name: languageName(language) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

export default router;
