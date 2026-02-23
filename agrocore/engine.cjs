// agrocore/engine.cjs
"use strict";

const { analyzeFormula } = require("../core/engine/analyzeFormula.cjs");

function preprocessFormulaText(text) {
  if (!text || typeof text !== "string") return "";

  // Convert commas and semicolons to new lines (parser-friendly)
  let t = text.replace(/,\s*/g, "\n");
  t = t.replace(/;\s*/g, "\n");

  // Clean extra spaces on each line
  t = t
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return t;
}

/**
 * Analyze from text only (legacy/back-compat)
 */
function analyzeFromText(text) {
  const cleaned = preprocessFormulaText(text);
  return analyzeFormula({ formula_text: cleaned });
}

/**
 * ✅ Analyze from full request payload (NEW)
 * This preserves: species/type/breed/region/version/phase/normalize/locale/etc.
 */
function analyzeFromRequest(body) {
  const b = body && typeof body === "object" ? { ...body } : {};

  // Prefer formula_text, but accept formulaText as alias
  const rawText = b.formula_text ?? b.formulaText ?? "";
  b.formula_text = preprocessFormulaText(String(rawText || ""));

  // Defaults kept minimal here; analyzeFormula already has defaults too.
  if (!b.locale) b.locale = "US";

  return analyzeFormula(b);
}

module.exports = { analyzeFromText, analyzeFromRequest };
