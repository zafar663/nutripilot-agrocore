// agrocore/api/routes/analyze.route.js  (ESM)
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const router = express.Router();

// __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use CommonJS require from ESM (best for .cjs)
const require = createRequire(import.meta.url);

// Load CORE engine (CommonJS)
const enginePath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "core",
  "engine",
  "analyzeFormula.cjs"
);

let analyzeFormula = null;

function loadEngine() {
  try {
    // IMPORTANT: require() caches modules; that's fine for production.
    // If you are actively editing core/engine/analyzeFormula.cjs and want hot-reload,
    // restart the server after changes.
    const engineMod = require(enginePath);
    analyzeFormula =
      (engineMod && (engineMod.analyzeFormula || engineMod.default)) || null;
    return true;
  } catch (err) {
    analyzeFormula = null;
    return false;
  }
}

// Attempt initial load
loadEngine();

function coerceString(v, fallback = "") {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function coerceBool(v, fallback = false) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(s)) return true;
    if (["false", "0", "no", "n"].includes(s)) return false;
  }
  return fallback;
}

router.post("/", (req, res) => {
  try {
    // If engine wasn't loaded at startup, retry once per request
    if (typeof analyzeFormula !== "function") {
      loadEngine();
    }

    if (typeof analyzeFormula !== "function") {
      return res.status(500).json({
        ok: false,
        error: "Engine not available",
        message:
          "analyzeFormula() could not be loaded from core/engine/analyzeFormula.cjs",
        debug: {
          enginePath,
          hint:
            "Verify file exists and is valid CommonJS: core/engine/analyzeFormula.cjs",
        },
      });
    }

    const body = req.body || {};

    // Body parser guard (if express.json() isn't enabled upstream, req.body may be undefined)
    const formula_text = coerceString(body.formula_text, "");
    if (!formula_text.trim()) {
      return res.status(400).json({
        ok: false,
        error: "Bad Request",
        message:
          "formula_text is required (string). Ensure server uses app.use(express.json()) before this route.",
        received_body_type: typeof req.body,
        received_keys: body && typeof body === "object" ? Object.keys(body) : [],
      });
    }

    // Forward-compatible input (do not reject unknown future fields)
    const input = {
      locale: coerceString(body.locale, "US"),
      formula_text,

      species: coerceString(body.species, "poultry"),
      type: coerceString(body.type, "broiler"),
      breed: coerceString(body.breed, "generic"),
      region: coerceString(body.region, "global"),
      version: coerceString(body.version, "v1"),
      phase: coerceString(body.phase, "starter"),

      // Optional override: allow calling with explicit reqKey
      reqKey: coerceString(body.reqKey, ""),

      normalize: coerceBool(body.normalize, false),

      // keep for later layers (pass-through)
      lab_overrides: body.lab_overrides || undefined,
      reported_nutrients: body.reported_nutrients || undefined,
    };

    if (!input.reqKey) delete input.reqKey;

    const result = analyzeFormula(input);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Internal Server Error",
      message: err?.message || String(err),
      stack: err?.stack || undefined,
    });
  }
});

export default router;

