const express = require("express");
const cors = require("cors");
const multer = require("multer");

// ✅ adapter that preprocesses text and calls the real engine
const { analyzeFromText } = require("./engine");

// ✅ ingest helpers (already in your repo)
const { ingestFileToFormulaText } = require("../core/ingest/ingestFileToFormulaText");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("AgroCore API running ✅");
});

app.get("/v1/health", (req, res) => {
  res.json({ ok: true, message: "AgroCore API running ✅" });
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
    console.error("AgroCore error:", err.message);
    return res.status(400).json({ ok: false, error: err.message });
  }
});

// -------------------- NEW: /v1/ingest --------------------
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /v1/ingest (multipart/form-data)
 * Field: file
 * Returns: { ok:true, text:"...", ingest:{...} }
 */
app.post("/v1/ingest", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ ok: false, error: "Missing file (multipart field name: 'file')" });
    }

    const originalName = req.file.originalname || "upload.bin";
    const mime = req.file.mimetype || "application/octet-stream";

    const out = await ingestFileToFormulaText({
      buffer: req.file.buffer,
      filename: originalName,
      contentType: mime
    });

    return res.json({
      ok: true,
      text: out?.text || "",
      ingest: out?.meta || { filename: originalName, contentType: mime }
    });
  } catch (err) {
    console.error("AgroCore ingest error:", err?.message || err);
    return res.status(400).json({ ok: false, error: err?.message || "ingest failed" });
  }
});
// ---------------------------------------------------------

// ✅ Render provides PORT automatically
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`AgroCore listening on ${PORT}`);
});
