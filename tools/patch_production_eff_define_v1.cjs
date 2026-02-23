"use strict";

const fs = require("fs");
const path = require("path");

function main() {
  const p = path.join(process.cwd(), "core/engine/analyzeFormula.cjs");
  let s = fs.readFileSync(p, "utf8");

  const ts = new Date().toISOString().replace(/[:.]/g, "");
  const bak = p.replace(/\.cjs$/, `.PROD_EFF_FIX_${ts}.BAK.cjs`);
  fs.writeFileSync(bak, s, "utf8");

  // 1) Ensure production_eff is defined inside analyzeFormula() scope
  // Insert right after: let _production_inferred = false;
  const anchor = /let\s+_production_inferred\s*=\s*false\s*;\s*\n/;
  if (!anchor.test(s)) {
    console.error("❌ Patch failed: could not find anchor 'let _production_inferred = false;'");
    process.exit(1);
  }

  if (!s.includes("const production_eff =")) {
    const inject =
`let _production_inferred = false;

// NP_PRODUCTION_EFF_DEFINED_v1
// production_eff is the final production used for requirements + meta
// - prefer explicit params.production (already stored in _production)
// - else safe default by type (never undefined)
const production_eff = (_production && String(_production).trim())
  ? String(_production).trim()
  : (String(type || "").toLowerCase() === "broiler" ? "meat"
    : (String(type || "").toLowerCase() === "layer" ? "egg"
      : (String(type || "").toLowerCase() === "broiler_breeder" ? "female" : "")));

`;
    s = s.replace(anchor, inject);
  }

  // 2) Ensure resolveRequirements uses production_eff (not _production / not undefined)
  // Replace any of these variants safely:
  s = s.replace(/production\s*:\s*_production\s*,/g, "production: production_eff,");
  s = s.replace(/production\s*:\s*production\s*,/g, "production: production_eff,");

  // 3) Ensure meta.production uses production_eff (so you never see undefined)
  // Replace "production: _production," when it exists in meta block
  s = s.replace(/production\s*:\s*_production\s*,/g, "production: production_eff,");

  fs.writeFileSync(p, s, "utf8");
  console.log("✅ Patched analyzeFormula.cjs: production_eff defined + used.");
  console.log("🧷 Backup:", bak);
}

main();
