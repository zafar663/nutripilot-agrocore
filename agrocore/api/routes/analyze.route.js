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
      ingredient_intelligence,
      virtual_ingredients,
      lab: labFromBody,
      ...rest
    } = req.body || {};

    // Build __lab_overrides_v2 from Ingredient Intelligence layer so the engine
    // uses the user's personal nutrient values instead of the raw DB values.
    let labParam = labFromBody || null;
    if (Array.isArray(ingredient_intelligence) && ingredient_intelligence.length > 0) {
      const _skipFields = new Set([
        'row_id','db_id','profile_id','base_ingredient_id','ingredient_id',
        'ingredient_code','price','min','max','price_basis','currency',
        'inclusion_min','inclusion_max','price_per_kg','note','source',
        'mill_id','plant_id','user_id','created_at','updated_at','version',
        'currency_mode','price_basis_mode','display_name','unit'
      ]);
      const v2Overrides = {};
      for (const row of ingredient_intelligence) {
        const name = String(row.ingredient_name || row.profile_id || '').trim();
        if (!name) continue;
        const fields = {};
        for (const [k, v] of Object.entries(row)) {
          if (_skipFields.has(k)) continue;
          if (typeof v === 'number' && Number.isFinite(v)) fields[k] = v;
        }
        if (Object.keys(fields).length > 0) v2Overrides[name] = fields;
      }
      labParam = { ...(labFromBody || {}), __lab_overrides_v2: v2Overrides };
    }

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
      lab: labParam,
      virtual_ingredients: (virtual_ingredients && typeof virtual_ingredients === 'object') ? virtual_ingredients : undefined,
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