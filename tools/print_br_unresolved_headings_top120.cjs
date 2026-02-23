"use strict";

const fs = require("fs");
const path = require("path");

const p = path.resolve("tools", "br_unresolved_rows.sample.json");
if (!fs.existsSync(p)) {
  console.error("Missing:", p);
  process.exit(1);
}
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const rows = Array.isArray(j) ? j : (j.sample || j.rows || j.items || []);
console.log("rows=", rows.length);

function norm(s){
  return String(s||"").toLowerCase().replace(/\s+/g," ").trim();
}

const freq = new Map();

for (const r of rows) {
  if (!r || typeof r !== "object") continue;
  if (r.mode !== "table_heading_unresolved") continue;

  const h = r.heading_raw || r.heading_norm || "";
  const k = norm(h);
  if (!k) continue;
  freq.set(k, (freq.get(k)||0) + 1);
}

const top = [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,120);

console.log("\nTop unresolved TABLE headings (120):");
for (const [k,v] of top) console.log(String(v).padStart(4," ") + "  " + k);
