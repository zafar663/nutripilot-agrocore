"use strict";

const fs = require("fs");

const p = "./core/engine/analyzeFormula.cjs";
let s = fs.readFileSync(p, "utf8");

// Must contain resolveRequirements call
const callAnchor = "req = resolveRequirements({";
const idx = s.indexOf(callAnchor);
if (idx < 0) {
  console.error("❌ Patch failed: could not find `req = resolveRequirements({`");
  process.exit(1);
}

// 1) Patch the production line inside resolveRequirements call.
// We accept any of these forms and normalize to: production: (_production || production_eff || ""),
const reProdLine = /production\s*:\s*[^,\n}]+(\s*,)?/m;

const slice = s.slice(idx, idx + 600); // window around call
if (!reProdLine.test(slice)) {
  console.error("❌ Patch failed: could not find a `production: ...` line near resolveRequirements call.");
  process.exit(1);
}

const patchedSlice = slice.replace(reProdLine, "production: (_production || production_eff || \"\"),");
s = s.slice(0, idx) + patchedSlice + s.slice(idx + slice.length);

// 2) If production_eff isn't defined anywhere, inject a tiny definition right before the resolveRequirements call.
if (!s.includes("const production_eff")) {
  // inject just before the callAnchor occurrence
  const inject = `
    // NP_PRODUCTION_DEFAULT_v3 (minimal safe default)
    const production_eff = (typeof _production === "string" && _production.trim())
      ? _production.trim()
      : (type === "broiler" ? "meat"
        : (type === "layer" ? "egg"
          : (type === "broiler_breeder" ? "female" : "")));

`;
  s = s.replace(callAnchor, inject + callAnchor);
}

fs.writeFileSync(p, s, "utf8");
console.log("✅ Patched analyzeFormula.cjs: resolveRequirements production is now safe, and production_eff is ensured.");
