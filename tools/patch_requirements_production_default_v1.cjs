"use strict";

const fs = require("fs");
const path = require("path");

function backupFile(p) {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const bak = p.replace(/\.cjs$/i, "") + `.PATCHBAK_${ts}.cjs`;
  fs.copyFileSync(p, bak);
  return bak;
}

function main() {
  const p = path.join(process.cwd(), "core/engine/analyzeFormula.cjs");
  let s = fs.readFileSync(p, "utf8");

  // If already patched, exit cleanly.
  if (s.includes("NP_PRODUCTION_DEFAULT_v1")) {
    console.log("ℹ️ Patch already applied: NP_PRODUCTION_DEFAULT_v1");
    return;
  }

  // We will inject a small block right before resolveRequirements({ ... })
  // by finding the first occurrence of "req = resolveRequirements({" inside the requirements section.
  const anchor = "req = resolveRequirements({";
  const idx = s.indexOf(anchor);
  if (idx < 0) {
    throw new Error('Patch failed: could not find anchor: "req = resolveRequirements({"');
  }

  // Insert block just before anchor
  const inject =
`\n    // NP_PRODUCTION_DEFAULT_v1\n    // Ensure production is never undefined (prevents path.join(undefined) crash)\n    const production_eff = (typeof production === "string" && production.trim())\n      ? production.trim()\n      : (type === "broiler" ? "meat"\n        : (type === "layer" ? "egg"\n          : (type === "broiler_breeder" ? "female" : "")));\n\n`;

  // Now also ensure we pass production_eff into resolveRequirements call.
  // We'll replace the first "{ locale," object line that contains "type," with a version that includes production: production_eff,
  // but we do it by a small targeted replace inside the resolveRequirements argument block.
  const before = s.slice(0, idx) + inject + s.slice(idx);

  // Replace inside the first resolveRequirements({ ... }) block:
  // Look for "type: type," and ensure "production: production_eff," appears after it (if not already).
  let after = before;

  const blockStart = after.indexOf(anchor);
  const blockEnd = after.indexOf("});", blockStart);
  if (blockEnd < 0) throw new Error("Patch failed: could not find end of resolveRequirements block");

  const block = after.slice(blockStart, blockEnd + 3);

  if (!block.includes("production:")) {
    const block2 = block.replace(/type\s*:\s*type\s*,/m, "type: type,\n      production: production_eff,");
    if (block2 === block) throw new Error("Patch failed: could not inject production into resolveRequirements block");
    after = after.slice(0, blockStart) + block2 + after.slice(blockEnd + 3);
  }

  // Also add production to meta output if meta is built from inputs (so your debug shows it).
  // We'll try a safe append by finding the first meta object assembly that includes "type:" and add production near it.
  // If not found, we skip (engine will still work).
  const metaHint = "type: type,";
  const metaPos = after.indexOf(metaHint);
  if (metaPos >= 0 && !after.includes("production: production_eff")) {
    // insert production right after first "type: type," occurrence (best-effort)
    after = after.replace(metaHint, metaHint + "\n    production: production_eff,");
  }

  const bak = backupFile(p);
  fs.writeFileSync(p, after, "utf8");

  console.log("✅ Patched analyzeFormula.cjs with NP_PRODUCTION_DEFAULT_v1");
  console.log("🧷 Backup:", bak);
}

main();
