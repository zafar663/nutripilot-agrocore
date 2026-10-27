// agrocore/START_AGROCORE_SERVER.mjs

import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
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
import customIngredientsRouter from "./api/routes/custom-ingredients.route.js";
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
import millLotLockRouter from "./api/routes/mill.lotlock.route.js";
import millFloorRouter from "./api/routes/mill.floor.route.js";
import millShareRouter from "./api/routes/mill.share.route.js";
import adminRouter from "./api/routes/admin.route.js";
import formulasRouter from "./api/routes/formulas.route.js";
import authRouter from "./api/routes/auth.route.js";
import billingRouter, { stripeWebhook } from "./api/routes/billing.route.js";
import registrationsRouter from "./api/routes/registrations.route.js";
import collaborationRouter from "./api/routes/collaboration.route.js";
import enzymeCurvesRouter from "./api/routes/enzyme-curves.route.js";
import { apiKeyAuth } from "./api/middleware/apiKeyAuth.js";
import { requireModule } from "./api/middleware/requireModule.js";
import { authGate } from "./api/middleware/auth-gate.mw.js";
import { millUserContext } from "./api/middleware/mill-user.mw.js";
import { trafficLogger } from "./api/middleware/traffic.mw.js";
import { setupCollabSocket } from "./collab.socket.js";

// FarmPulse
import farmPulseRouter from "./api/routes/farm-pulse.route.js";
import pricesRouter from "./api/routes/prices.route.js";
import purchaseOrdersRouter from "./api/routes/purchase-orders.route.js";
import rawMaterialsRouter from "./api/routes/raw-materials.route.js";
import ingredientIntelligenceRouter from "./api/routes/ingredient-intelligence.route.js";
import userPrefsRouter from "./api/routes/user-prefs.route.js";
import premixRouter from "./api/routes/premix.route.js";
import dietIntentRouter from "./api/routes/diet-intent.route.js";
import translateRouter from "./api/routes/translate.route.js";

// Nutrix full web label route
import nutrixLabelRoute from "../api/routes/nutrix.label.route.js";
import nutrixReleaseRoute from "../api/routes/nutrix.release.route.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env'), override: true });
console.log('TWILIO SID:', process.env.TWILIO_ACCOUNT_SID ? 'loaded' : 'MISSING');
console.log('SMTP:', process.env.SMTP_HOST ? `loaded (${process.env.SMTP_HOST})` : 'MISSING');
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
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: (process.env.CORS_ORIGINS || 'https://agrocoreprime.com,https://v2.agrocoreprime.com,http://127.0.0.1:4200,http://localhost:4200').split(',').map(s => s.trim()), methods: ['GET', 'POST'] }
});
setupCollabSocket(io);

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
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'https://agrocoreprime.com,https://v2.agrocoreprime.com,http://127.0.0.1:4200,http://localhost:4200')
  .split(',').map(s => s.trim()).filter(Boolean);
function corsOriginFn(origin, cb) {
  if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
  cb(null, false); // silently block — no Access-Control-Allow-Origin header sent
}
app.use(cors({ origin: corsOriginFn, methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization", "x-nutrix-user"], credentials: true }));
app.options("*", cors({ origin: corsOriginFn, credentials: true }));
app.post("/v1/billing/webhook", express.raw({ type: "application/json" }), stripeWebhook);
app.use(express.json({ limit: "2mb" }));
app.use(express.text({ type: ["text/csv", "text/plain", "application/xml"], limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Resolve Authorization header (JWT or API key) to req.user / x-nutrix-user,
// enabling external API-key access to /v1/optimize, /v1/formulas, etc.
app.use(apiKeyAuth);

// Attach Turso client (BYOD) + enforce module access + live user status check.
app.use(authGate);
app.use(millUserContext);
app.use(trafficLogger);

app.get("/v1/health", (_req, res) => {
  res.json({ ok: true, message: "AgroCore API running OK" });
});

app.use("/v1/translate", translateRouter);

// Main routes
app.use("/v1/analyze", analyzeRouter);

// Routes that already include full /v1 paths internally
app.use("/", ingestRouter);
app.use("/", optimizeRouter);
app.use("/", multimixRouter);
app.use("/", ingredientSearchRouter);
app.use("/", ingredientsRouter);
app.use("/", customIngredientsRouter);

// QC optimizer bridge
app.use("/v1/qc/optimizer", qcOptimizerRoute);

// Nutrix routes
app.use("/v1/nutrix-ai", aiRoute);
app.use("/v1/lite", liteRoute);
app.use("/v1/nutrix", nutrixLabelRoute);
app.use("/v1/nutrix", nutrixReleaseRoute);
app.use("/v1/intelligence", intelligenceRouter);
// Feed Mill Intelligence routes (MillIQ module)
app.use("/v1/mill/batch",     requireModule("milliq"), millBatchRouter);
app.use("/v1/mill/deviation", requireModule("milliq"), millDeviationRouter);
app.use("/v1/mill/qc",        requireModule("milliq"), millQcRouter);
app.use("/v1/mill/inventory", requireModule("milliq"), millInventoryRouter);
app.use("/v1/mill/dispatch",  requireModule("milliq"), millDispatchRouter);
app.use("/v1/mill/downtime",  requireModule("milliq"), millDowntimeRouter);
app.use("/v1/mill/report",    requireModule("milliq"), millReportRouter);
app.use("/v1/mill/config",    requireModule("milliq", "vendorpulse", "nutrix"), millConfigRouter);
app.use("/v1/mill/weighbridge", requireModule("milliq"), millWeighbridgeRouter);
app.use("/v1/mill/lot-lock", requireModule("milliq"), millLotLockRouter);
app.use("/v1/mill/floor", requireModule("milliq"), millFloorRouter);
app.use("/v1/mill/share", requireModule("milliq", "nutrix"), millShareRouter);
app.use("/api/farmpulse", requireModule("farmpulse"), farmPulseRouter);
app.use("/v1/prices", pricesRouter);
app.use("/v1", purchaseOrdersRouter);
app.use("/v1/raw-materials", rawMaterialsRouter);
app.use("/v1/ingredient-intelligence", ingredientIntelligenceRouter);
app.use("/v1/user-prefs", userPrefsRouter);
app.use("/v1/premix", premixRouter);
app.use("/v1/diet-intent", dietIntentRouter);
app.use("/v1/price-lists", priceListsRouter);
app.use("/v1/admin", requireModule("admin"), adminRouter);
app.use("/", formulasRouter);
app.use("/", authRouter);
app.use("/", billingRouter);
app.use("/v1", collaborationRouter);
app.use("/v1", enzymeCurvesRouter);


// Requirement options
app.get("/v1/requirements/options", (_req, res) => {
  try {
    const filePath = path.join(
      __dirname,
      "../core/db/requirements/_index/requirements.options.v1.json"
    );

    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const includeHollow = String(_req.query?.include_hollow || "") === "1";
    if (!includeHollow && Array.isArray(data.species)) {
      data.species = data.species.filter((s) => {
        const key = String(s?.key || "").toLowerCase();
        if (s?.sellable === false || s?.hollow === true || s?.preview === true) return false;
        return !["rabbit", "camel", "alpaca", "llama", "camelid", "aqua", "aquaculture", "dog", "cat"].includes(key);
      });
    }
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
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : (err?.message || String(err)),
  });
});

// Start
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

httpServer.listen(PORT, () => {
  console.log(`AgroCore listening on ${PORT} (HTTP + WebSocket)`);
});