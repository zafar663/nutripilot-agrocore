import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import Database from "better-sqlite3";

const require = createRequire(import.meta.url);

const { loadIngredients } = require("../../../core/db/ingredients/_index/LOAD_INGREDIENTS.cjs");

// ── Per-user mill.db loader ────────────────────────────────────────────────────
function userMillDbPath(username) {
  if (!username) return null;
  const safe = String(username).toLowerCase().replace(/@/g, "_at_").replace(/\./g, "_dot_");
  return `/var/www/nutripilot-agrocore/data/users/${safe}/mill.db`;
}

function loadUserIngredientLibrary(millId, username) {
  try {
    const dbPath = userMillDbPath(username);
    if (!dbPath || !fs.existsSync(dbPath)) return null;
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare(
      "SELECT rows_json FROM ingredient_intelligence_library WHERE mill_id=? AND db_id='base' LIMIT 1"
    ).get(millId);
    db.close();
    if (!row?.rows_json) return null;
    const rows = JSON.parse(row.rows_json);
    // Index by ingredient_code for O(1) lookup
    const index = {};
    for (const r of rows) {
      if (r.ingredient_code) index[r.ingredient_code.toLowerCase()] = r;
    }
    return index;
  } catch (e) {
    console.warn("[lite] Could not load user ingredient library:", e.message);
    return null;
  }
}


const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CASE_DIR = path.resolve(__dirname, "../../data/lite-cases");
const DEFAULT_TTL_HOURS = 48;

fs.mkdirSync(CASE_DIR, { recursive: true });

function nowIso() {
  return new Date().toISOString();
}

function publicWebBase() {
  return String(process.env.PUBLIC_WEB_BASE || process.env.NUTRIX_WEB_BASE || "https://agrocoreprime.com").replace(/\/$/, "");
}

function liteUrl(caseId, token) {
  const urlPath = `/nutrix-lite-portal/${caseId}/${token}`;
  return { lite_url_path: urlPath, lite_url: `${publicWebBase()}${urlPath}` };
}

function expiresAtIso(hours = DEFAULT_TTL_HOURS) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function makeId(prefix = "LITE") {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 10).replaceAll("-", "");
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${stamp}-${rand}`;
}

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

function casePath(caseId) {
  const safe = String(caseId || "").replace(/[^A-Za-z0-9_-]/g, "");
  return path.join(CASE_DIR, `${safe}.json`);
}

function readCase(caseId) {
  const p = casePath(caseId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeCase(obj) {
  fs.writeFileSync(casePath(obj.case_id), JSON.stringify(obj, null, 2));
}

function isExpired(obj) {
  return new Date(obj.expires_at).getTime() < Date.now();
}

function enrichIngredientPool(pool = [], caseCtx = {}) {
  const staticResult = loadIngredients({ species: "poultry", region: "us", version: "v1" });
  const staticDb = staticResult?.db || {};

  // Try to load the user's ingredient library from mill.db (takes priority over static)
  const millId  = String(caseCtx.mill_id  || "").trim();
  const username = String(caseCtx.username || "").trim();
  const userDb  = (millId && username) ? loadUserIngredientLibrary(millId, username) : null;

  return pool.map((row) => {
    const id = String(row.id || row.ingredient_id || "").toLowerCase();

    // Prefer user's DB row over static DB row
    const userRow   = userDb   ? (userDb[id]   || null) : null;
    const staticRow = staticDb[id] || null;

    if (!userRow && !staticRow) {
      return { ...row, _enrich_status: "NOT_FOUND" };
    }

    // Merge: static first, then user row on top (user values win)
    const merged = { ...(staticRow || {}), ...(userRow || {}) };

    return {
      ...row,
      ...merged,
      _enrich_status: userRow ? "USER_DB" : "STATIC_DB"
    };
  });
}

const { applyIngredientRulesToPool } = require("../../../core/services/ingredient-rules.service.cjs");

// GET /v1/lite/cases/:caseId/:token/ingredients
// Returns the correct ingredient library for this case (user DB if available, else static)
router.get("/cases/:caseId/:token/ingredients", (req, res) => {
  try {
    const { caseId, token } = req.params;
    const liteCase = readCase(caseId);

    if (!liteCase) return res.status(404).json({ ok: false, error: "CASE_NOT_FOUND" });
    if (liteCase.token !== token) return res.status(403).json({ ok: false, error: "INVALID_TOKEN" });

    const ctx = liteCase.context || {};
    const millId   = String(ctx.mill_id  || "").trim();
    const username = String(ctx.username || "").trim();
    const userDb   = (millId && username) ? loadUserIngredientLibrary(millId, username) : null;

    // Build flat array of ingredient rows for the frontend
    let items = [];
    if (userDb) {
      items = Object.entries(userDb).map(([code, r]) => ({
        ingredient_id: code,
        ingredient_code: code,
        ingredient_name: r.ingredient_name || r.name || code,
        ...r,
        _source: "user_db"
      }));
    } else {
      // Fall back to static DB
      const staticResult = loadIngredients({ species: "poultry", region: "us", version: "v1" });
      const staticDb = staticResult?.db || {};
      items = Object.entries(staticDb).map(([id, r]) => ({
        ingredient_id: id,
        ingredient_name: r.display_name || id,
        ...r,
        _source: "static"
      }));
    }

    res.json({ ok: true, items, source: userDb ? "user_db" : "static" });
  } catch (err) {
    res.status(500).json({ ok: false, error: "INGREDIENTS_LOAD_FAILED", message: err?.message });
  }
});

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "nutrix-lite",
    route_version: "lite_route_v1_case_token_2026-04-28",
    case_dir: CASE_DIR
  });
});

router.post("/cases", (req, res) => {
  try {
    const body = req.body || {};

    const caseId = makeId("LITE");
    const token = makeToken();

    const liteCase = {
      case_id: caseId,
      token,
      source: body.source || "whatsapp",
      status: "active",

      created_at: nowIso(),
      expires_at: expiresAtIso(Number(body.ttl_hours || DEFAULT_TTL_HOURS)),

      context: body.context || {},
      original_formula: body.original_formula || [],
      quick_fix_formula: body.quick_fix_formula || [],
      reported_nutrients: body.reported_nutrients || {},
      calculated_before: body.calculated_before || {},
      calculated_after: body.calculated_after || {},
      nutrient_comparison: body.nutrient_comparison || [],
      ingredient_changes: body.ingredient_changes || [],

      allowed_actions: {
        view: true,
        optimize: true,
        download_pdf: true,
        download_excel: true,
        send_back_to_whatsapp: true,
        edit_formula: true,
        edit_min_max: true,
        edit_ingredient_db: false,
        access_full_dashboard: false,
        ...(body.allowed_actions || {})
      }
    };

    writeCase(liteCase);

    const urls = liteUrl(caseId, token);
    res.json({
      ok: true,
      case_id: caseId,
      token,
      expires_at: liteCase.expires_at,
      lite_url_path: urls.lite_url_path,
      lite_url: urls.lite_url
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "LITE_CASE_CREATE_FAILED",
      message: err?.message || String(err)
    });
  }
});

router.get("/cases/:caseId/:token", (req, res) => {
  try {
    const { caseId, token } = req.params;
    const liteCase = readCase(caseId);

    if (!liteCase) {
      return res.status(404).json({ ok: false, error: "CASE_NOT_FOUND" });
    }

    if (liteCase.token !== token) {
      return res.status(403).json({ ok: false, error: "INVALID_TOKEN" });
    }

    if (isExpired(liteCase)) {
      liteCase.status = "expired";
      writeCase(liteCase);
      return res.status(410).json({ ok: false, error: "CASE_EXPIRED" });
    }

    const safeCase = { ...liteCase };
    delete safeCase.token;
    const urls = liteUrl(caseId, token);

    res.json({
      ok: true,
      case: safeCase,
      lite_url_path: urls.lite_url_path,
      lite_url: urls.lite_url
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "LITE_CASE_READ_FAILED",
      message: err?.message || String(err)
    });
  }
});

router.post("/cases/:caseId/:token/optimize", async (req, res) => {
  try {
    const { caseId, token } = req.params;
    const liteCase = readCase(caseId);

    if (!liteCase) {
      return res.status(404).json({ ok: false, error: "CASE_NOT_FOUND" });
    }

    if (liteCase.token !== token) {
      return res.status(403).json({ ok: false, error: "INVALID_TOKEN" });
    }

    if (isExpired(liteCase)) {
      liteCase.status = "expired";
      writeCase(liteCase);
      return res.status(410).json({ ok: false, error: "CASE_EXPIRED" });
    }

    const rawPayload = req.body || {};

const enrichedPoolRaw = enrichIngredientPool(rawPayload.ingredient_pool || [], liteCase.context || {});

const ruleResult = applyIngredientRulesToPool(enrichedPoolRaw, {
  species: rawPayload.species,
  type: rawPayload.type,
  production: rawPayload.production,
  breed: rawPayload.breed,
  phase: rawPayload.phase
});

const enrichedPool = ruleResult.ingredient_pool;

const optimizerPayload = {
  ...rawPayload,
  ingredient_pool: enrichedPool,
  practical_rule_version: ruleResult.rule_version,
  practical_rule_warnings: ruleResult.warnings,
  practical_rule_detected: ruleResult.detected
};

    const optimizeResponse = await fetch("http://localhost:3001/v1/optimize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(optimizerPayload)
    });

    const resultText = await optimizeResponse.text();

    let result;
    try {
      result = JSON.parse(resultText);
    } catch {
      result = {
        ok: false,
        raw: resultText
      };
    }

    if (!optimizeResponse.ok) {
      return res.status(optimizeResponse.status).json({
        ok: false,
        error: "UPSTREAM_OPTIMIZE_FAILED",
        upstream_status: optimizeResponse.status,
        upstream_result: result
      });
    }

    liteCase.last_optimization = result;
    liteCase.updated_at = nowIso();
    writeCase(liteCase);

    return res.json(result);

  } catch (err) {
    console.error("LITE OPTIMIZE ERROR:", err);

    return res.status(500).json({
      ok: false,
      error: "LITE_OPTIMIZE_FAILED",
      message: err?.message || String(err)
    });
  }
});
router.patch("/cases/:caseId/:token", (req, res) => {
  try {
    const { caseId, token } = req.params;
    const liteCase = readCase(caseId);

    if (!liteCase) {
      return res.status(404).json({ ok: false, error: "CASE_NOT_FOUND" });
    }

    if (liteCase.token !== token) {
      return res.status(403).json({ ok: false, error: "INVALID_TOKEN" });
    }

    if (isExpired(liteCase)) {
      return res.status(410).json({ ok: false, error: "CASE_EXPIRED" });
    }

    const body = req.body || {};

    if (body.quick_fix_formula !== undefined) liteCase.quick_fix_formula = body.quick_fix_formula;
    if (body.nutrient_comparison !== undefined) liteCase.nutrient_comparison = body.nutrient_comparison;
    if (body.context !== undefined) liteCase.context = { ...liteCase.context, ...body.context };
    if (body.calculated_after !== undefined) liteCase.calculated_after = body.calculated_after;

    liteCase.updated_at = new Date().toISOString();
    writeCase(liteCase);

    res.json({ ok: true, case_id: caseId });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "LITE_CASE_PATCH_FAILED",
      message: err?.message || String(err)
    });
  }
});
export default router;

