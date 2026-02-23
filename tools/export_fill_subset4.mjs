import fs from "fs";
import path from "path";

const jsonPath = process.argv[2];
const outCsv   = process.argv[3];

if (!jsonPath || !outCsv) {
  console.error("Usage: node tools/export_fill_subset4.mjs <ingredients_json> <out_csv>");
  process.exit(1);
}

const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const want = ["corn","soybean_meal_48","canola_meal","fish_meal"];

const fields = [
  "key","name","source","dm_pct","ee","starch","ndf","adf","ash",
  "zn_mgkg","cu_mgkg","mn_mgkg","fe_mgkg","se_mgkg","i_mgkg",
  "choline_mgkg","folate_mgkg","biotin_mgkg"
];

function esc(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

let lines = [];
lines.push(fields.join(","));

for (const key of want) {
  const ing = j.ingredients[key];
  if (!ing) continue;
  const row = fields.map(f => (f === "key" ? esc(key) : esc(ing[f])));
  lines.push(row.join(","));
}

fs.mkdirSync(path.dirname(outCsv), { recursive: true });
fs.writeFileSync(outCsv, lines.join("\r\n"), "utf8");
console.log("OK: exported subset CSV rows=" + (lines.length - 1) + " to " + outCsv);

