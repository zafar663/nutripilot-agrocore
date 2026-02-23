"use strict";

const fs = require("fs");
const path = require("path");

const p = path.join(process.cwd(), "core", "engine", "analyzeFormula.cjs");
let s = fs.readFileSync(p, "utf8");

// 1) Remove the broken early production_eff block (uses _production before it is declared)
const reBadHotfix =
/\s*\/\/\s*----\s*Production inference\s*----\s*\r?\n\s*\/\/\s*NP_PRODUCTION_EFF_HOTFIX_v1[\s\S]*?\r?\n\s*if\s*\(!?_production\)\s*_production\s*=\s*production_eff;\s*\r?\n/s;

s = s.replace(reBadHotfix, "\n");

// 2) Insert ONE correct block immediately AFTER _production is declared.
const anchor = '  let _production = String((params.production || "") || "").trim().toLowerCase();';

if (!s.includes(anchor)) {
  console.error("❌ Anchor not found for _production declaration. Aborting.");
  process.exit(1);
}

if (s.includes("NP_PRODUCTION_EFF_SINGLE_SOURCE_v1")) {
  console.log("ℹ️ Already patched. No changes made.");
  process.exit(0);
}

const inject = `
  // NP_PRODUCTION_EFF_SINGLE_SOURCE_v1
  // Single source of truth for production:
  // - uses params.production if provided
  // - otherwise infers from type
  let _production_inferred = false;

  // Normalize/alias incoming production values
  if (_production === "egg") _production = "layer";
  if (_production === "female") _production = "breeder";

  const production_eff = (_production && _production.trim())
    ? _production.trim()
    : (String(type || "").toLowerCase() === "broiler" ? "meat"
      : (String(type || "").toLowerCase() === "layer" ? "layer"
        : (String(type || "").toLowerCase() === "broiler_breeder" ? "breeder" : "")));

  if (!_production) {
    _production = production_eff;
    _production_inferred = true;
  }
`;

s = s.replace(anchor, anchor + "\n" + inject);

// 3) Remove the DUPLICATE production block inside try { ... } (your NP_PRODUCTION_DEFAULT_v1 block)
const reDupTryBlock =
/\r?\n\s*\/\/\s*NP_PRODUCTION_DEFAULT_v1[\s\S]*?\r?\n\s*req\s*=\s*resolveRequirements\(/s;

if (reDupTryBlock.test(s)) {
  // Delete from that comment up to just before "req = resolveRequirements("
  s = s.replace(
    /(\r?\n\s*\/\/\s*NP_PRODUCTION_DEFAULT_v1[\s\S]*?)(\r?\n\s*req\s*=\s*resolveRequirements\()/,
    "\n$2"
  );
}

// 4) Ensure resolveRequirements uses production_eff (never undefined)
s = s.replace(
  /production:\s*\(\s*_production\s*\|\|\s*production_eff\s*\|\|\s*""\s*\)\s*,/g,
  "production: production_eff,"
);

// Backup + write
const bak = p.replace(/\.cjs$/, `.FIX_PROD_ONCE_${new Date().toISOString().replace(/[:.]/g,"-")}.BAK.cjs`);
fs.writeFileSync(bak, fs.readFileSync(p, "utf8"), "utf8");
fs.writeFileSync(p, s, "utf8");

console.log("✅ Fixed analyzeFormula.cjs: production_eff defined once AFTER _production; duplicate block neutralized.");
console.log("🧷 Backup:", bak);
