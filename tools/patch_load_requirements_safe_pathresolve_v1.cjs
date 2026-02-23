"use strict";

const fs = require("fs");

const p = "./core/db/requirements/_index/LOAD_REQUIREMENTS.cjs";
let s = fs.readFileSync(p, "utf8");

// backup
const ts = new Date().toISOString().replace(/[:.]/g,"").slice(0,15);
fs.writeFileSync(p.replace(/\.cjs$/, `.PATCHBAK_${ts}.cjs`), s, "utf8");

// 1) Inject safePathResolve helper once (near the top)
if (!s.includes("function safePathResolve")) {
  // put it after: const path = require("node:path");  OR require("path");
  const anchor = /const\s+path\s*=\s*require\((?:'|")node:path(?:'|")\)\s*;\s*\n|const\s+path\s*=\s*require\((?:'|")path(?:'|")\)\s*;\s*\n/;
  const m = s.match(anchor);
  if (!m) {
    console.error("❌ Patch failed: could not find `const path = require(...)` in LOAD_REQUIREMENTS.cjs");
    process.exit(1);
  }

  const inject = m[0] + `
function safePathResolve(...parts) {
  // NP_SAFE_PATH_RESOLVE_v1
  // Prevents path.resolve(undefined) crash; preserves behavior for normal strings.
  return path.resolve(...parts.map(p => (p == null ? "" : String(p))));
}

`;
  s = s.replace(anchor, inject);
}

// 2) Replace ONLY the first path.resolve(...) inside resolveOptionB with safePathResolve(...)
// We do this surgically so we don't change other logic.
const idxFn = s.indexOf("function resolveOptionB");
if (idxFn < 0) {
  console.error("❌ Patch failed: could not find `function resolveOptionB`");
  process.exit(1);
}

const idxNext = s.indexOf("\nfunction ", idxFn + 10);
const block = s.slice(idxFn, idxNext > 0 ? idxNext : s.length);

const iResolve = block.indexOf("path.resolve(");
if (iResolve < 0) {
  console.error("❌ Patch failed: could not find `path.resolve(` inside resolveOptionB");
  process.exit(1);
}

const blockPatched = block.replace("path.resolve(", "safePathResolve(");
s = s.slice(0, idxFn) + blockPatched + s.slice(idxFn + block.length);

// write
fs.writeFileSync(p, s, "utf8");
console.log("✅ Patched LOAD_REQUIREMENTS.cjs: resolveOptionB now uses safePathResolve() (minimal fix).");
console.log("🧷 Backup:", p.replace(/\.cjs$/, `.PATCHBAK_${ts}.cjs`));
