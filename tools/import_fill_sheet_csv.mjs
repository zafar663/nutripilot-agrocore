import fs from "fs";

const jsonPath = process.argv[2];
const csvPath  = process.argv[3];

if (!jsonPath || !csvPath) {
  console.error("Usage: node tools/import_fill_sheet_csv.mjs <ingredients_json> <csv_path>");
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];

    if (inQuotes) {
      if (c === '"' && n === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; }
      else { cur += c; }
    }
  }
  row.push(cur.replace(/\r$/, ""));
  rows.push(row);
  return rows;
}

const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
if (!j.ingredients || typeof j.ingredients !== "object") throw new Error("JSON missing .ingredients object");

const table = parseCsv(fs.readFileSync(csvPath, "utf8"));
if (table.length < 2) throw new Error("CSV has no data rows");

const header = table[0].map(h => h.trim());
const idxKey = header.indexOf("key");
if (idxKey === -1) throw new Error("CSV missing 'key' column");

let updated = 0;
let skippedRows = 0;
let nonNumericSets = 0;

for (let r = 1; r < table.length; r++) {
  const row = table[r];
  if (!row || row.length === 0) continue;

  const key = (row[idxKey] || "").trim();
  if (!key) continue;

  const ing = j.ingredients[key];
  if (!ing) { skippedRows++; continue; }

  for (let c = 0; c < header.length; c++) {
    const field = header[c];
    if (!field || field === "key") continue;

    const raw = (row[c] ?? "").toString().trim();
    if (!raw) continue; // only overwrite non-empty

    if (field === "name" || field === "source") {
      ing[field] = raw;
      updated++;
      continue;
    }

    const num = Number(raw);
    if (!Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(raw)) {
      ing[field] = num;
      updated++;
    } else {
      ing[field] = raw;
      nonNumericSets++;
    }
  }
}

fs.writeFileSync(jsonPath, JSON.stringify(j, null, 2), "utf8");
console.log("OK: import complete. updated_cells=" + updated + " skipped_rows=" + skippedRows + " non_numeric_sets=" + nonNumericSets);
