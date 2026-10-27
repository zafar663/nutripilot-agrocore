const fs = require("fs");
const path = require("path");

const RULE_PATH = path.join(
  __dirname,
  "..",
  "db",
  "ingredient-rules",
  "poultry.ingredient-rules.v1.json"
);

function safeLower(v) {
  return String(v || "").trim().toLowerCase();
}

function loadIngredientRules() {
  return JSON.parse(fs.readFileSync(RULE_PATH, "utf8"));
}

function detectFamilies(pool = []) {
  const ids = new Set(pool.map((x) => safeLower(x.id || x.ingredient_id)));
  const names = new Set(pool.map((x) => safeLower(x.display_name || x.ingredient_name)));

  const hasXylanase =
    ids.has("xylanase") ||
    Array.from(ids).some((x) => x.includes("xylanase") || x.includes("nsp")) ||
    Array.from(names).some((x) => x.includes("xylanase") || x.includes("nsp"));

  return { hasXylanase };
}

function pickRule(rule, context = {}, families = {}) {
  if (!rule) return null;

  const type = safeLower(context.type || context.production || "broiler");
  const phase = safeLower(context.phase || "starter");

  let selected = rule.default || null;

  if (rule[type] && rule[type][phase]) {
    selected = rule[type][phase];
  }

  if (selected && selected.with_xylanase && selected.without_xylanase) {
    selected = families.hasXylanase ? selected.with_xylanase : selected.without_xylanase;
  }

  return selected;
}

function applyIngredientRulesToPool(pool = [], context = {}) {
  const rulesDoc = loadIngredientRules();
  const rules = rulesDoc.rules || {};
  const families = detectFamilies(pool);

  const warnings = [];

  const enriched = pool.map((row) => {
    const id = safeLower(row.id || row.ingredient_id);
    const rule = rules[id];
    const selected = pickRule(rule, context, families);

    if (!selected) {
      return {
        ...row,
        rule_status: "NO_RULE"
      };
    }

    const inclusion = Number(row.inclusion || 0);
    const guideMax = selected.max != null ? Number(selected.max) : null;
    if (guideMax != null && Number.isFinite(inclusion) && inclusion > guideMax + 0.001) {
      warnings.push({
        ingredient_id: id,
        severity: "WARN",
        message: `${row.display_name || row.ingredient_name || id} is at ${inclusion}% (guideline Max ${guideMax}%). Advisory only — not a hard limit and not infeasible.`
      });
    }

    if (rule.requires_if_high && inclusion > Number(rule.requires_if_high.threshold || 0)) {
      if (rule.requires_if_high.ingredient_family === "xylanase" && !families.hasXylanase) {
        warnings.push({
          ingredient_id: id,
          severity: "WARN",
          message: rule.requires_if_high.message
        });
      }
    }

    return {
      ...row,
      rule_status: "ADVISORY",
      rule_family: rule.family || null,
      rule_note: rule.notes || null,
      rule_guide_max: guideMax
    };
  });

  return {
    ingredient_pool: enriched,
    warnings,
    rule_version: rulesDoc.version,
    detected: families
  };
}

module.exports = {
  loadIngredientRules,
  applyIngredientRulesToPool
};

