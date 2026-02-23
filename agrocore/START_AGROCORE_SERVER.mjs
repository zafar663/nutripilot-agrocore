// agrocore/START_AGROCORE_SERVER.mjs
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import analyzeRouter from "./api/routes/analyze.route.js";
import ingestRouter from "./api/routes/ingest.route.js";

const app = express();

// ===== Runtime lock (internal only) =====
globalThis.__AGROCORE_STARTED_AT__ ||= new Date().toISOString();

app.get("/v1/debug/runtime", (req, res) => {
  const key = req.header("x-internal-key");
  const expected = process.env.INTERNAL_DEBUG_KEY;

  if (!expected) return res.status(403).json({ ok: false, error: "INTERNAL_DEBUG_KEY not set" });
  if (key !== expected) return res.status(403).json({ ok: false, error: "Forbidden" });

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
// =======================================

// middleware
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// health
app.get("/v1/health", (_req, res) => {
  res.json({ ok: true, message: "AgroCore API running OK" });
});

// Mount routers
app.use("/v1/analyze", analyzeRouter);

// ingest.route.js already defines router.post("/v1/ingest", ...)
// so mount it at "/" to avoid double-prefixing
app.use("/", ingestRouter);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.path, method: req.method });
});

// error handler
app.use((err, _req, res, _next) => {
  res.status(500).json({
    ok: false,
    error: "Internal Server Error",
    message: err?.message || String(err),
  });
});

// start
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(PORT, () => {
  console.log(`AgroCore listening on ${PORT}`);
});
