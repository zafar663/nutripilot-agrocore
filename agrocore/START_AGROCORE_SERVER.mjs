// agrocore/START_AGROCORE_SERVER.mjs

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import analyzeRouter from "./api/routes/analyze.route.js";
import ingestRouter from "./api/routes/ingest.route.js";
import optimizeRouter from "./api/routes/optimize.route.js";
import multimixRouter from "./api/routes/multimix.route.js";
import ingredientSearchRouter from "./api/routes/ingredient-search.route.js";
import priceListsRouter from "./api/routes/price-lists.route.js";
import ingredientsRouter from "./api/routes/ingredients.route.js";
import qcOptimizerRoute from "./api/routes/qc.optimizer.route.js";
import aiRoute from "./api/routes/ai.route.js";
import liteRoute from "./api/routes/lite.route.js";
import intelligenceRouter from "./api/routes/intelligence.route.js";
// Feed Mill Intelligence Engine
import millBatchRouter     from "./api/routes/mill.batch.route.js";
import millDeviationRouter from "./api/routes/mill.deviation.route.js";
import millQcRouter        from "./api/routes/mill.qc.route.js";
import millInventoryRouter from "./api/routes/mill.inventory.route.js";
import millDispatchRouter  from "./api/routes/mill.dispatch.route.js";
import millDowntimeRouter  from "./api/routes/mill.downtime.route.js";
import millReportRouter    from "./api/routes/mill.report.route.js";
import millConfigRouter    from "./api/routes/mill.config.route.js";
import millWeighbridgeRouter from "./api/routes/mill.weighbridge.route.js";
import adminRouter from "./api/routes/admin.route.js";
import formulasRouter from "./api/routes/formulas.route.js";
import authRouter from "./api/routes/auth.route.js";
import registrationsRouter from "./api/routes/registrations.route.js";

// FarmPulse
import farmPulseRouter from "./api/routes/farm-pulse.route.js";
import pricesRouter from "./api/routes/prices.route.js";
import purchaseOrdersRouter from "./api/routes/purchase-orders.route.js";
import rawMaterialsRouter from "./api/routes/raw-materials.route.js";

// Nutrix full web label route
import nutrixLabelRoute from "../api/routes/nutrix.label.route.js";
import nutrixReleaseRoute from "../api/routes/nutrix.release.route.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });
console.log('TWILIO SID:', process.env.TWILIO_ACCOUNT_SID ? 'loaded' : 'MISSING');
// Initialise Feed Mill Intelligence database
import { runMillMigrations } from '../core/db/mill/mill.migrations.js';
import { initFarmPulseDb } from '../core/db/farmpulse/farmpulse.db.js';
// Initialise Nutrix user database
import { getNutrixDb } from '../core/db/nutrix/nutrix.db.js';
try {
  getNutrixDb('default');
  console.log('[NutrixDB] Default database ready');
} catch (err) {
  console.error('[NutrixDB] Init failed:', err.message);
}

try {
  runMillMigrations();
  console.log('[MillDB] Database ready');

// Initialise FarmPulse database
try {
  initFarmPulseDb();
  console.log('[FarmPulseDB] Database ready');
} catch (err) {
  console.error('[FarmPulseDB] Init failed:', err.message);
}
} catch (err) {
  console.error('[MillDB] Database init failed:', err.message);
}

const app = express();

// ===== Runtime lock internal only =====
globalThis.__AGROCORE_STARTED_AT__ ||= new Date().toISOString();

app.get("/v1/debug/runtime", (req, res) => {
  const key = req.header("x-internal-key");
  const expected = process.env.INTERNAL_DEBUG_KEY;

  if (!expected) {
    return res.status(403).json({ ok: false, error: "INTERNAL_DEBUG_KEY not set" });
  }

  if (key !== expected) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  res.json({
    ok: true,
    engine_version: "AgroCore v1.4",
    version: "AgroCore v1.4 (registry-driven evaluation)",
    pid: process.pid,
    node: process.version,
    port: Number(process.env.PORT || 3001),
    started_at_utc: globalThis.__AGROCORE_STARTED_AT__,
  });
});

// Middleware
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Health
app.get("/v1/health", (_req, res) => {
  res.json({ ok: true, message: "AgroCore API running OK" });
});

// Main routes
app.use("/v1/analyze", analyzeRouter);

// Routes that already include full /v1 paths internally
app.use("/", ingestRouter);
app.use("/", optimizeRouter);
app.use("/", multimixRouter);
app.use("/", ingredientSearchRouter);
app.use("/", ingredientsRouter);

// QC optimizer bridge
app.use("/v1/qc/optimizer", qcOptimizerRoute);

// Nutrix routes
app.use("/v1/nutrix-ai", aiRoute);
app.use("/v1/lite", liteRoute);
app.use("/v1/nutrix", nutrixLabelRoute);
app.use("/v1/nutrix", nutrixReleaseRoute);
app.use("/v1/intelligence", intelligenceRouter);
// Feed Mill Intelligence routes
app.use("/v1/mill/batch",     millBatchRouter);
app.use("/v1/mill/deviation", millDeviationRouter);
app.use("/v1/mill/qc",        millQcRouter);
app.use("/v1/mill/inventory", millInventoryRouter);
app.use("/v1/mill/dispatch",  millDispatchRouter);
app.use("/v1/mill/downtime",  millDowntimeRouter);
app.use("/v1/mill/report",    millReportRouter);
app.use("/v1/mill/config",    millConfigRouter);
app.use("/v1/mill/weighbridge", millWeighbridgeRouter);
app.use("/api/farmpulse", farmPulseRouter);
app.use("/v1/prices", pricesRouter);
app.use("/v1", purchaseOrdersRouter);
app.use("/v1/raw-materials", rawMaterialsRouter);
app.use("/v1/price-lists", priceListsRouter);
app.use("/v1/admin", adminRouter);
app.use("/", formulasRouter);
app.use("/",authRouter);


// Requirement options
app.get("/v1/requirements/options", (_req, res) => {
  try {
    const filePath = path.join(
      __dirname,
      "../core/db/requirements/_index/requirements.options.v1.json"
    );

    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    res.json(data);
  } catch (err) {
    console.error("Options error:", err);
    res.status(500).json({
      ok: false,
      error: "Failed to load options",
    });
  }
});

app.use("/", registrationsRouter);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Not Found",
    path: req.path,
    method: req.method,
  });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error("Server error:", err);
  res.status(500).json({
    ok: false,
    error: "Internal Server Error",
    message: err?.message || String(err),
  });
});

// Start
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.listen(PORT, () => {
  console.log(`AgroCore listening on ${PORT}`);
});