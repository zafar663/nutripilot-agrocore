import fs from "fs";
import path from "path";

const jsonPath = process.argv[2];
const outCsv   = process.argv[3];

if (!jsonPath || !outCsv) {
  console.error("Usage: node tools/export_fill_sheet_csv.mjs <ingredients_json> <out_csv>");
  process.exit(1);
}

const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
if (!j.ingredients || typeof j.ingredients !== "object") {
  throw new Error("JSON missing .ingredients object");
}

const fields = [
  "key","name","source","me","cp",
  "ee","starch","sugar","ndf","adf","ash",
  "ca","p_total","avp","na","k","cl",
  "zn_mgkg","cu_mgkg","mn_mgkg","fe_mgkg","se_mgkg","i_mgkg",
  "choline_mgkg","riboflavin_mgkg","niacin_mgkg","pantothenic_acid_mgkg","b6_mgkg","b12_mgkg","folate_mgkg","biotin_mgkg"
];

function esc(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const keys = Object.keys(j.ingredients).sort();

let lines = [];
lines.push(fields.join(","));

for (const key of keys) {
  const ing = j.ingredients[key] || {};
  const row = [];
  for (const f of fields) {
    if (f === "key") row.push(esc(key));
    else row.push(esc(ing[f]));
  }
  lines.push(row.join(","));
}

fs.mkdirSync(path.dirname(outCsv), { recursive: true });
fs.writeFileSync(outCsv, lines.join("\r\n"), "utf8");

console.log("OK: exported fill sheet rows=" + keys.length + " to " + outCsv);




