"use strict";
const fs = require("fs");

const p = "./core/engine/analyzeFormula.cjs";
let s = fs.readFileSync(p, "utf8");
const before = s;

// Patch 1: production_eff should use _production (not production)
s = s.replace(
  /const\s+production_eff\s*=\s*\(typeof\s+production\s*===/g,
  "const production_eff = (typeof _production ==="
);

// Patch 2: resolveRequirements should use production_eff (not _production)
s = s.replace(
  /production\s*:\s*_production\s*,/g,
  "production: production_eff,"
);

if (s === before) {
  console.error("❌ Patch failed: no changes applied. (Patterns not found)");
  process.exit(1);
}

fs.writeFileSync(p, s, "utf8");
console.log("✅ Patched analyzeFormula.cjs: production default + resolveRequirements production fixed.");
