"use strict";

const fs = require("fs");
const path = require("path");

const p = path.join(process.cwd(), "core", "engine", "analyzeFormula.cjs");
let s = fs.readFileSync(p, "utf8");

// Match: let _production_inferred = false;
const re = /\blet\s+_production_inferred\s*=\s*false\s*;\s*\r?\n/g;

let count = 0;
s = s.replace(re, (m) => {
  count++;
  return count === 1 ? m : ""; // keep first, remove rest
});

if (count <= 1) {
  console.log("ℹ️ No duplicate _production_inferred found (count=" + count + "). No changes made.");
  process.exit(0);
}

const bak = p.replace(/\.cjs$/, `.DEDUP_PROD_INF_${new Date().toISOString().replace(/[:.]/g,"-")}.BAK.cjs`);
fs.writeFileSync(bak, fs.readFileSync(p, "utf8"), "utf8");
fs.writeFileSync(p, s, "utf8");

console.log("✅ Removed duplicate declarations of _production_inferred. Count found:", count);
console.log("🧷 Backup:", bak);
