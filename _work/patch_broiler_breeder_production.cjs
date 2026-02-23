// _work/patch_broiler_breeder_production.cjs
"use strict";

const fs = require("fs");
const path = require("path");

function readJson(p) {
  const raw = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}
function writeJson(p, j) {
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n", "utf8");
}

const p = path.join(
  __dirname,
  "..",
  "core",
  "db",
  "requirements",
  "poultry",
  "broiler_breeder",
  "v1",
  "requirements.index.poultry.broiler_breeder.v1.json"
);

if (!fs.existsSync(p)) {
  console.error("❌ Missing file:", p);
  process.exit(1);
}

const j = readJson(p);

// Ensure productions object exists
j.productions = (j.productions && typeof j.productions === "object") ? j.productions : {};

// If already fixed, exit cleanly
if (j.productions.breeder) {
  console.log("ℹ️ productions.breeder already exists. No change.");
  process.exit(0);
}

const prod = j.productions;
const keys = Object.keys(prod);

// Choose best source key to alias into breeder
// (This mirrors what we did for layer: layer <- egg)
let srcKey =
  (prod.female && "female") ||
  (prod.parent && "parent") ||
  (prod.breeder_female && "breeder_female") ||
  (prod.broiler_breeder && "broiler_breeder") ||
  (prod.meat && "meat") ||
  (prod.layer && "layer") ||
  (keys.length === 1 ? keys[0] : null);

if (!srcKey) {
  console.error("❌ Could not infer a productions source key to copy into productions.breeder.");
  console.error("   Existing productions keys:", keys);
  process.exit(1);
}

prod.breeder = prod[srcKey];

writeJson(p, j);

console.log(`✅ Added productions.breeder = productions.${srcKey}`);
console.log("✅ Wrote:", p);
