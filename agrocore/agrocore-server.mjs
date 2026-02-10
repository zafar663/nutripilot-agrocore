import express from "express";
import cors from "cors";
import multer from "multer";
import { createRequire } from "module";

// If ./engine.cjs is CommonJS (module.exports), this works:
const require = createRequire(import.meta.url);
const { analyzeFromText } = require("./engine.cjs");

// core ingest is ESM (uses import), so we import it normally:
import { ingestFileToFormulaText } from "../core/ingest/ingestFileToFormulaText.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("AgroCore API running âœ…");
});

app.get("/v1/health", (req, res) => {
  res.json({ ok: true, message: "AgroCore API running âœ…" });
});

/**
 * POST /v1/analyze
 * Accepts:
 *  - { text: "corn 60, soybean meal 30" }
 *  - { formula_text: "corn 60\nsoybean meal 30" }
 */
app.post("/v1/analyze", (req, res) => {
  try {
    const body = req.body || {};
    const text = body.text || body.formula_text;

    if (!text || typeof text !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Send 'text' (or 'formula_text')"
      });
    }

    const result = analyzeFromText(text);
    return res.json(result);
  } catch (err) {
    console.error("AgroCore error:", err?.message || err);
    return res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
});

// ---- /v1/ingest (multipart) ----
const upload = multer({ storage: multer.memoryStorage() });

app.post("/v1/ingest", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ ok: false, error: "Missing file (multipart field name: 'file')" });
    }

    const filename = req.file.originalname || "upload.bin";
    const contentType = req.file.mimetype || "application/octet-stream";

    const out = await ingestFileToFormulaText({
      buffer: req.file.buffer,
      filename,
      contentType
    });

    return res.json({
      ok: true,
      formula_text: out?.formula_text || "",
      ingest: out || { filename, contentType }
    });
  } catch (err) {
    console.error("AgroCore ingest error:", err?.message || err);
    return res.status(400).json({ ok: false, error: err?.message || String(err) });
  }
});

// Render provides PORT automatically
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`AgroCore listening on ${PORT}`);
});







