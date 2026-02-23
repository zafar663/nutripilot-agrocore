"use strict";

const fs = require("fs");

const p = ".\\core\\engine\\analyzeFormula.cjs";
let s = fs.readFileSync(p, "utf8");

// 1) Make resolveRequirements use production_eff (even if currently _production)
s = s.replace(/production\s*:\s*_production\s*,/g, "production: production_eff,");
s = s.replace(/production\s*:\s*production\s*,/g, "production: production_eff,");

// 2) Ensure production_eff is declared in-scope immediately before resolveRequirements call
// We inject only if we don't already see a "const production_eff" within ~600 chars before the call.
const anchor = "req = resolveRequirements({";
const pos = s.indexOf(anchor);
if (pos < 0) {
  console.error("❌ Patch failed: could not find 'req = resolveRequirements({' in analyzeFormula.cjs");
  process.exit(1);
}

const windowStart = Math.max(0, pos - 800);
const window = s.slice(windowStart, pos);
const alreadyDefinedNearby = /const\s+production_eff\s*=/.test(window);

if (!alreadyDefinedNearby) {
  const inject = `
    // NP_PRODUCTION_EFF_FINAL_v1
    // Ensure production is never undefined (prevents path.resolve/join crashes in requirements loader)
    const production_eff = (typeof _production === "string" && _production.trim())
      ? _production.trim()
      : (type === "broiler" ? "meat"
        : (type === "layer" ? "egg"
          : (type === "broiler_breeder" ? "female" : "")));

`;
  s = s.slice(0, pos) + inject + s.slice(pos);
}

// 3) Final sanity: the resolveRequirements call must contain production: production_eff
if (!/resolveRequirements\(\{\s*[\s\S]*production\s*:\s*production_eff\s*,/m.test(s)) {
  console.error("❌ Patch failed: resolveRequirements call still does not include 'production: production_eff,'");
  process.exit(1);
}

// Backup + write
const bak = ".\\core\\engine\\analyzeFormula.PROD_EFF_FINAL_FIX_" + new Date().toISOString().replace(/[:.]/g,"-") + ".BAK.cjs";
fs.writeFileSync(bak, fs.readFileSync(p, "utf8"), "utf8");
fs.writeFileSync(p, s, "utf8");

console.log("✅ Patched analyzeFormula.cjs: production_eff ensured + resolveRequirements uses it.");
console.log("🧷 Backup:", bak);
