// ============================================================
// NutriPilot — Custom Ingredient Databases Route
// Nutritionist-managed, per-species, per-mill ingredient databases.
// nutripilot-agrocore/agrocore/api/routes/custom-ingredients.route.js
// ============================================================
import express from "express";
import { createRequire } from "module";
import { ensureNutrixDatabaseForUser } from "../../../core/services/ensure-nutrix-database.js";

const require = createRequire(import.meta.url);
const customDb = require("../../../core/services/custom-ingredient-db.service.cjs");

const router = express.Router();

const ok = (res, data) => res.json({ ok: true, ...data });
const err = (res, e, status = 500) => res.status(status).json({ ok: false, error: e.message || String(e) });

function millIdOf(req) {
  const raw = String(req.query.mill_id || req.body?.mill_id || "").trim();
  if (raw && raw !== "default") return raw;
  return ownerOf(req) ? "personal" : "";
}

function ownerOf(req) {
  return String(req.nutrixUser || "").toLowerCase();
}

router.get("/v1/custom-ingredient-dbs", async (req, res) => {
  try {
    const millId = millIdOf(req);
    const species = req.query.species ? String(req.query.species).toLowerCase() : null;
    if (!ownerOf(req)) return ok(res, { items: [], count: 0, base_name: "" });
    try {
      await ensureNutrixDatabaseForUser(req, { millId: millId || "personal", species: species || "poultry" });
    } catch (seedErr) {
      console.error("[custom-ingredient-dbs] Nutrix database seed failed:", seedErr?.message || seedErr);
    }
    const items = customDb.listDbs(millId, species, ownerOf(req));
    const base_name = customDb.getBaseLibraryName(millId, species || "poultry", ownerOf(req));
    return ok(res, { items, count: items.length, base_name });
  } catch (e) {
    return err(res, e);
  }
});

router.put("/v1/custom-ingredient-dbs/base-name", (req, res) => {
  try {
    const millId = millIdOf(req);
    const species = String(req.body?.species || req.query.species || "poultry").toLowerCase();
    const name = String(req.body?.name || "").trim();
    if (!ownerOf(req)) return err(res, new Error("Sign in to rename this library."), 401);
    if (!name) return err(res, new Error("name required"), 400);
    const base_name = customDb.setBaseLibraryName(millId, species, ownerOf(req), name);
    return ok(res, { base_name });
  } catch (e) {
    return err(res, e);
  }
});

router.post("/v1/custom-ingredient-dbs", (req, res) => {
  try {
    const millId = millIdOf(req);
    const { species, name } = req.body || {};
    if (!species) return err(res, new Error("species required"), 400);
    if (!ownerOf(req)) return err(res, new Error("Sign in to create a database."), 401);
    if (!millId) return err(res, new Error("Sign in to create a database."), 401);

    const db = customDb.createDb(millId, species, name, ownerOf(req));
    return ok(res, { db });
  } catch (e) {
    return err(res, e);
  }
});

router.get("/v1/custom-ingredient-dbs/:id", (req, res) => {
  try {
    const millId = millIdOf(req);
    const db = customDb.getDb(millId, req.params.id, ownerOf(req));
    if (!db) return err(res, new Error("Custom ingredient database not found"), 404);
    return ok(res, { db });
  } catch (e) {
    return err(res, e);
  }
});

router.put("/v1/custom-ingredient-dbs/:id", (req, res) => {
  try {
    const millId = millIdOf(req);
    const { name } = req.body || {};
    const db = customDb.renameDb(millId, req.params.id, name, ownerOf(req));
    if (!db) return err(res, new Error("Custom ingredient database not found"), 404);
    return ok(res, { db });
  } catch (e) {
    return err(res, e);
  }
});

router.delete("/v1/custom-ingredient-dbs/:id", (req, res) => {
  try {
    const millId = millIdOf(req);
    const deleted = customDb.deleteDb(millId, req.params.id, ownerOf(req));
    if (!deleted) return err(res, new Error("Custom ingredient database not found"), 404);
    return ok(res, { deleted: true });
  } catch (e) {
    return err(res, e);
  }
});

router.post("/v1/custom-ingredient-dbs/:id/ingredients", (req, res) => {
  try {
    const millId = millIdOf(req);
    const { ingredient_name } = req.body || {};
    const row = customDb.addIngredient(millId, req.params.id, ingredient_name, ownerOf(req));
    if (!row) return err(res, new Error("Custom ingredient database not found"), 404);
    return ok(res, { ingredient: row });
  } catch (e) {
    return err(res, e);
  }
});

router.put("/v1/custom-ingredient-dbs/:id/ingredients/:ingredientId", (req, res) => {
  try {
    const millId = millIdOf(req);
    const fields = { ...(req.body || {}) };
    delete fields.mill_id;

    const row = customDb.updateIngredient(millId, req.params.id, req.params.ingredientId, fields, ownerOf(req));
    if (!row) return err(res, new Error("Ingredient not found"), 404);
    return ok(res, { ingredient: row });
  } catch (e) {
    return err(res, e);
  }
});

router.delete("/v1/custom-ingredient-dbs/:id/ingredients/:ingredientId", (req, res) => {
  try {
    const millId = millIdOf(req);
    const deleted = customDb.deleteIngredient(millId, req.params.id, req.params.ingredientId, ownerOf(req));
    if (!deleted) return err(res, new Error("Ingredient not found"), 404);
    return ok(res, { deleted: true });
  } catch (e) {
    return err(res, e);
  }
});

router.post("/v1/custom-ingredient-dbs/:id/nutrients", (req, res) => {
  try {
    const millId = millIdOf(req);
    const { key, label, unit } = req.body || {};
    if (!key) return err(res, new Error("key required"), 400);

    const db = customDb.addCustomNutrient(millId, req.params.id, { key, label, unit }, ownerOf(req));
    if (!db) return err(res, new Error("Custom ingredient database not found"), 404);
    return ok(res, { db });
  } catch (e) {
    return err(res, e);
  }
});

export default router;
