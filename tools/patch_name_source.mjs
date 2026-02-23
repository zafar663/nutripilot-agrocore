import fs from "fs";

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error("Usage: node tools/patch_name_source.mjs <ingredients_json>");
  process.exit(1);
}

const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
if (!j.ingredients || typeof j.ingredients !== "object") throw new Error("JSON missing .ingredients object");

let changed = 0;
for (const [key, ing] of Object.entries(j.ingredients)) {
  if (!ing.name || String(ing.name).trim() === "") { ing.name = key; changed++; }
  if (!ing.source || String(ing.source).trim() === "") { ing.source = "us_sid_v1"; changed++; }
}

fs.writeFileSync(jsonPath, JSON.stringify(j, null, 2), "utf8");
console.log("OK: patched name/source. changes=" + changed);
