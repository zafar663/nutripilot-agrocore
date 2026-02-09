import express from "express";

// We import your engine module and then pick the right exported function at runtime.
// Adjust this path only if your main engine entry file is NOT core/engine/index.js
import * as Engine from "../../../core/engine/index.js";

const router = express.Router();

function pickAnalyzeFn() {
  // try common names first
  return (
    Engine.analyzeFormula ||
    Engine.analyze ||
    Engine.run ||
    Engine.default
  );
}

router.post("/v1/analyze", async (req, res) => {
  try {
    const { locale = "US", formula_text = "", lab_overrides } = req.body || {};

    if (!String(formula_text).trim()) {
      return res.status(400).json({ status: "ERROR", message: "formula_text is required" });
    }

    const analyzeFn = pickAnalyzeFn();
    if (typeof analyzeFn !== "function") {
      return res.status(500).json({
        status: "ERROR",
        message:
          "AgroCore engine analyze function not found. Export analyzeFormula/analyze/run (or default) from core/engine/index.js",
      });
    }

    const result = await analyzeFn({ locale, formula_text, lab_overrides });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      status: "ERROR",
      message: "analyze failed",
      error: String(err?.message || err),
    });
  }
});

export default router;
