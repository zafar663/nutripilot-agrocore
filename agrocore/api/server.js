import express from "express";
import cors from "cors";

import analyzeRoute from "./routes/analyze.route.js";
import ingestRoute from "./routes/ingest.route.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Health check
app.get("/v1/health", (req, res) => {
  res.json({
    status: "OK",
    service: "AgroCore",
    time: new Date().toISOString()
  });
});

// Routes
app.use(analyzeRoute);
app.use(ingestRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AgroCore API running on port ${PORT}`);
});
