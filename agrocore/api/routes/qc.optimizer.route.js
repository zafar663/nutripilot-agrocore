// ============================================================
// Nutrix QC → Optimizer Bridge
// Enterprise Safe Route
// ============================================================

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FORMULA_SET_PATH = path.resolve(
  __dirname,
  "../../../data/formula_sets/broiler_starters.json"
);

const OPTIMIZER_ENDPOINT = "http://localhost:3001/v1/optimize";

function safeParseJson(text, sourceLabel = "JSON source") {
  try {
    return JSON.parse(String(text).replace(/^\uFEFF/, "").trim());
  } catch (err) {
    throw new Error(`${sourceLabel} is not valid JSON: ${err.message}`);
  }
}

function loadFormulaSet() {
  if (!fs.existsSync(FORMULA_SET_PATH)) {
    throw new Error(`Formula set file not found: ${FORMULA_SET_PATH}`);
  }

  const raw = fs.readFileSync(FORMULA_SET_PATH, "utf8");
  const parsed = safeParseJson(raw, `Formula set file ${FORMULA_SET_PATH}`);

  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.formulas)) return parsed.formulas;
  if (Array.isArray(parsed.items)) return parsed.items;

  throw new Error(
    `Formula set file loaded but no formulas/items array found: ${FORMULA_SET_PATH}`
  );
}

function buildStartingFormulaFromFormula(formula) {
  const items = Array.isArray(formula.ingredients) ? formula.ingredients : [];

  return items
    .map((ing) => ({
      id: ing.id,
      inclusion: Number(ing.inclusion ?? 0)
    }))
    .filter((x) => Number.isFinite(x.inclusion) && x.inclusion > 0);
}

function buildOptimizerPayload(formula) {
  const payload = {
    species: formula.species,
    type: formula.type,
    production: formula.production,
    breed: formula.breed,
    phase: formula.phase,
    region: formula.region || "us",
    version: formula.version || "v1",
    formula_text: formula.formula_text || "",
    ingredient_pool: Array.isArray(formula.ingredient_pool) ? formula.ingredient_pool : [],
    nutrient_constraints: Array.isArray(formula.nutrient_constraints) ? formula.nutrient_constraints : [],
    cost_basis: formula.cost_basis || "per_metric_ton",
    optimization_mode: formula.optimization_mode || "least_cost",
    movement_penalty: true,
    max_movement_pct: 5,
    enforce_constraints: true
  };

  const startingFormula = buildStartingFormulaFromFormula(formula);
  if (startingFormula.length > 0) {
    payload.starting_formula = startingFormula;
  }

  return payload;
}

async function readOptimizerResponse(response) {
  const rawText = await response.text();

  let parsedBody = null;
  try {
    parsedBody = safeParseJson(rawText, "Optimizer response");
  } catch (_err) {
    parsedBody = {
      ok: false,
      raw_response: rawText
    };
  }

  return parsedBody;
}

router.post("/run", async (req, res) => {
  try {
    const { affected_formulas } = req.body || {};

    if (!Array.isArray(affected_formulas) || affected_formulas.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No formulas supplied from QC impact analysis"
      });
    }

    const formulaSet = loadFormulaSet();
    const optimizer_results = [];

    for (const affected of affected_formulas) {
      const formula = formulaSet.find(
        (f) => f.formula_id === affected.formula_id
      );

      if (!formula) {
        optimizer_results.push({
          formula_id: affected.formula_id,
          optimizer_status: "formula_not_found"
        });
        continue;
      }

      const optimizerBody = buildOptimizerPayload(formula);

      try {
        const optResponse = await fetch(OPTIMIZER_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(optimizerBody)
        });

        const optJson = await readOptimizerResponse(optResponse);

        optimizer_results.push({
          formula_id: affected.formula_id,
          formula_name: formula.formula_name,
          http_status: optResponse.status,
          optimizer_status:
            optJson?.status ||
            (optJson?.ok === true ? "ok" : optResponse.ok ? "unknown" : "http_error"),
          optimizer_output: optJson,
          audit: {
            ingredient_pool_count: Array.isArray(optimizerBody.ingredient_pool)
              ? optimizerBody.ingredient_pool.length
              : 0,
            nutrient_constraint_count: Array.isArray(optimizerBody.nutrient_constraints)
              ? optimizerBody.nutrient_constraints.length
              : 0,
            has_starting_formula: Array.isArray(optimizerBody.starting_formula) &&
              optimizerBody.starting_formula.length > 0
          }
        });
      } catch (err) {
        optimizer_results.push({
          formula_id: affected.formula_id,
          formula_name: formula.formula_name,
          optimizer_status: "optimizer_error",
          error: err.message
        });
      }
    }

    const summary = {
      formulas_received: affected_formulas.length,
      optimizer_runs: optimizer_results.length,
      success_count: optimizer_results.filter(
        (r) => r.optimizer_status === "optimal" || r.optimizer_status === "ok"
      ).length,
      failure_count: optimizer_results.filter(
        (r) => r.optimizer_status !== "optimal" && r.optimizer_status !== "ok"
      ).length
    };

    return res.json({
      ok: true,
      message: "QC triggered optimizer run completed",
      optimizer_results,
      summary,
      meta: {
        route: "qc.optimizer.route",
        optimizer_endpoint: OPTIMIZER_ENDPOINT,
        formula_source: FORMULA_SET_PATH,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "QC optimizer execution failed",
      message: err.message
    });
  }
});

export default router;