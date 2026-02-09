import express from "express";
import multer from "multer";

// ⬇️ this comes from CORE (engine side)
import { ingestFileToFormulaText } from "../../../core/ingest/ingestFileToFormulaText.js";

const router = express.Router();

// store uploaded file in memory (not disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

/**
 * POST /v1/ingest
 * Accepts: Excel / (later PDF, Image)
 * Returns: formula_text
 */
router.post("/v1/ingest", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: "ERROR",
        message: "No file uploaded"
      });
    }

    const result = ingestFileToFormulaText({
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      filename: req.file.originalname
    });

    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      status: "ERROR",
      message: "Ingest failed",
      error: String(err?.message || err)
    });
  }
});

export default router;
