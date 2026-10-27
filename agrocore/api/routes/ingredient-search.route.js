import express from "express";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { searchIngredients } = require("../../../core/services/ingredient-search.service.cjs");

const router = express.Router();

router.get("/v1/ingredients/search", (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Number(req.query.limit || 8);

    if (!q) {
      return res.json([]);
    }

    const results = searchIngredients(q, limit);
    return res.json(results);
  } catch (err) {
    console.error("[ingredient-search.route] error:", err);
    return res.status(500).json({
      ok: false,
      error: "INGREDIENT_SEARCH_FAILED",
      message: err.message
    });
  }
});

export default router;