"use strict";

const fs = require("node:fs");
const path = require("node:path");

function main() {
  const p = path.join(process.cwd(), "core", "engine", "analyzeFormula.cjs");
  let s = fs.readFileSync(p, "utf8");

  const bak = p.replace(/\.cjs$/i, `.PROD_EFF_HOTFIX_${new Date().toISOString().replace(/[:.]/g,"-")}.BAK.cjs`);
  fs.writeFileSync(bak, s, "utf8");

  // 1) Ensure resolveRequirements call uses production_eff (not _production)
  // This is safe even if it already does.
  s = s.replace(
    /production\s*:\s*_production\s*,/g,
    "production: production_eff,"
  );

  // 2) Inject production_eff definition in-function, in a stable location.
  // Anchor: after the block that defines _production / _production_inferred (your file has it).
  if (!s.includes("NP_PRODUCTION_EFF_HOTFIX_v1")) {
    const anchor = "// ---- Production inference ----";
    const idx = s.indexOf(anchor);
    if (idx === -1) {
      console.error("❌ Hotfix failed: could not find anchor:", anchor);
      process.exit(1);
    }

    // Insert AFTER the production inference block header line (right after the line)
    const insertAt = idx + anchor.length;
    const inject = `
  // NP_PRODUCTION_EFF_HOTFIX_v1
  // Define production_eff in a guaranteed scope (prevents ReferenceError).
  // Keep your existing _production inference rules; only fill if empty.
  const production_eff =
    (typeof _production === "string" && _production.trim())
      ? _production.trim()
      : (type === "broiler" ? "meat"
        : (type === "layer" ? "egg"
          : (type === "broiler_breeder" ? "female" : "")));

  if (!_production) _production = production_eff;

`;
    s = s.slice(0, insertAt) + inject + s.slice(insertAt);
  }

  fs.writeFileSync(p, s, "utf8");
  console.log("✅ Hotfix applied: production_eff defined + resolveRequirements uses it.");
  console.log("🧷 Backup:", bak);
}

main();