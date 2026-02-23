"use strict";

const fs = require("fs");

const p = "./core/engine/analyzeFormula.cjs";
let s = fs.readFileSync(p, "utf8");

// 1) Fix production_eff block to use _production (not undefined 'production')
const reProdEff = /const\s+production_eff\s*=\s*\(typeof\s+production\s*===\s*"string"[\s\S]*?\)\s*;\s*/m;
if (!reProdEff.test(s)) {
  console.error("❌ Patch failed: could not find production_eff block that uses 'production'.");
  process.exit(1);
}
s = s.replace(reProdEff, `const production_eff = (typeof _production === "string" && _production.trim())
      ? _production.trim()
      : (type === "broiler" ? "meat"
        : (type === "layer" ? "egg"
          : (type === "broiler_breeder" ? "female" : "")));

`);

// 2) Ensure resolveRequirements uses production_eff (not _production)
const reProdArg = /production\s*:\s*_production\s*,/g;
if (!reProdArg.test(s)) {
  console.error("❌ Patch failed: could not find 'production: _production,' in resolveRequirements call.");
  process.exit(1);
}
s = s.replace(reProdArg, "production: production_eff,");

fs.writeFileSync(p, s, "utf8");
console.log("✅ Patched analyzeFormula.cjs: production_eff uses _production, and resolveRequirements uses production_eff.");
