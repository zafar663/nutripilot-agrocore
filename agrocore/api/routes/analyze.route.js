import express from "express";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { analyzeFormula } = require("../../../core/engine/analyzeFormula.cjs");

const router = express.Router();

function pickAnalyzeFn() {
  return analyzeFormula;
}

router.post("/", async (req, res) => {
  try {
    const {
      locale = "US",
      formula_text: raw_formula_text = "",
      resolved_rows = [],
      lab_overrides,
      ...rest
    } = req.body || {};

    const buildFormulaTextFromResolvedRows = (rows = []) => {
      if (!Array.isArray(rows) || !rows.length) return "";
      return rows
        .filter((r) => r && r.ingredient_id && Number.isFinite(Number(r.inclusion)))
        .map((r) => `${String(r.ingredient_id).trim()} ${Number(r.inclusion)}`)
        .join("\n");
    };

    const formula_text =
      Array.isArray(resolved_rows) && resolved_rows.length
        ? buildFormulaTextFromResolvedRows(resolved_rows)
        : String(raw_formula_text || "").trim();

    if (!String(formula_text).trim()) {
      return res.status(400).json({
        status: "ERROR",
        message: "formula_text or resolved_rows is required"
      });
    }

    const analyzeFn = pickAnalyzeFn();
    if (typeof analyzeFn !== "function") {
      return res.status(500).json({
        status: "ERROR",
        message: "AgroCore engine analyze function not found.",
        analyze_type: typeof analyzeFn
      });
    }

    const result = await analyzeFn({
      locale,
      formula_text,
      resolved_rows,
      lab_overrides,
      ...rest
    });

    // AIE — Log analysis event
    try {
      const AIE = require("../../../core/intelligence/AIE.cjs");
      AIE.onFormulaAnalyzed({
        species: rest?.species,
        type: rest?.type,
        production: rest?.production,
        body_weight_kg: rest?.body_weight_kg,
        intake_pct_bw: rest?.intake_pct_bw,
        formula_text
      });
    } catch (_aieErr) {}

    return res.json(result);
  } catch (err) {
    console.error("[analyze.route] error:", err);
    return res.status(500).json({
      status: "ERROR",
      message: err instanceof Error ? err.message : "Internal server error"
    });
  }
});

export default router;