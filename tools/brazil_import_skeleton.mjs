import fs from "fs";

const jsonPath = process.argv[2];
const listPath = process.argv[3];

if (!jsonPath || !listPath) {
  console.error("Usage: node tools/brazil_import_skeleton.mjs <ingredients_json> <list_txt>");
  process.exit(1);
}

function toKey(s) {
  return s
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const raw = fs.readFileSync(jsonPath, "utf8");
const j = JSON.parse(raw);
if (!j.ingredients || typeof j.ingredients !== "object") {
  throw new Error("JSON missing .ingredients object");
}

const lines = fs
  .readFileSync(listPath, "utf8")
  .split(/\r?\n/)
  .map((x) => x.trim())
  .filter(Boolean);

let added = 0;
let skipped = 0;

for (const name of lines) {
  const key = toKey(name);
  if (j.ingredients[key]) {
    skipped++;
    continue;
  }
  j.ingredients[key] = {
    name,
    source: "brazilian_tables_5e"
  };
  added++;
}

fs.writeFileSync(jsonPath, JSON.stringify(j, null, 2), "utf8");
console.log("OK: skeleton import complete. added=" + added + " skipped_existing=" + skipped + " total_now=" + Object.keys(j.ingredients).length);
