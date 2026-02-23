"use strict";

const fs = require("fs");
const path = require("path");

function readJson(p) {
  let raw = fs.readFileSync(p, "utf8");
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[(),;]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s\+\-\/\.%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function firstNumber(arr) {
  if (!Array.isArray(arr)) return null;
  for (const x of arr) {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function buildResolvers(structuredDb, aliasesNode) {
  // aliases: key -> canonical_id
  const aliasToId = new Map();
  for (const [k, v] of Object.entries(aliasesNode || {})) {
    const nk = norm(k);
    const id = String(v || "").trim();
    if (!nk || !id) continue;
    aliasToId.set(nk, id);
  }

  // display_name norm -> id
  const nameToId = new Map();
  for (const [id, row] of Object.entries(structuredDb || {})) {
    const dn = row && row.display_name ? String(row.display_name) : "";
    const ndn = norm(dn);
    if (ndn && !nameToId.has(ndn)) nameToId.set(ndn, id);
  }

  function resolveHeadingToId(headingRaw) {
    const n = norm(headingRaw);
    if (!n) return null;

    // direct alias hit
    if (aliasToId.has(n)) return aliasToId.get(n);

    // direct display_name hit
    if (nameToId.has(n)) return nameToId.get(n);

    // contains match against display_name norms (fallback)
    let best = null;
    let bestLen = -1;
    for (const [ndn, id] of nameToId.entries()) {
      if (ndn.length < 5) continue;
      if (n.includes(ndn) && ndn.length > bestLen) { best = id; bestLen = ndn.length; }
    }
    if (best) return best;

    // contains match against alias norms (fallback)
    let bestA = null;
    let bestALen = -1;
    for (const [ak, id] of aliasToId.entries()) {
      if (ak.length < 5) continue;
      if (n.includes(ak) && ak.length > bestALen) { bestA = id; bestALen = ak.length; }
    }
    return bestA;
  }

  return { resolveHeadingToId };
}

function main() {
  const tablesPath = process.argv[2] || path.resolve("tools", "br_tables_parsed.v7c.json");

  const dbPath = path.resolve("core", "db", "ingredients", "poultry", "br", "v1", "ingredients.poultry.br.sid.v1.json");
  const aliPath = path.resolve("core", "db", "aliases", "poultry", "br", "v1", "aliases.poultry.br.v1.json");

  const jTables = readJson(tablesPath);
  const tables = jTables.tables || [];

  const ing = readJson(dbPath);
  const DB = (ing.db && typeof ing.db === "object") ? ing.db : (ing.db ? ing.db : ing.db);

  // handle if file is { _LOCK, db }
  const structuredDb = ing.db || ing.DB || ing.ingredients || ing;
  const aliasesJ = readJson(aliPath);
  const aliasesNode = aliasesJ.aliases || aliasesJ.db || aliasesJ.map || {};

  const { resolveHeadingToId } = buildResolvers(structuredDb.db ? structuredDb.db : structuredDb, aliasesNode);

  const targetDb = structuredDb.db ? structuredDb.db : structuredDb;

  let tablesApplied = 0;
  let tablesUnresolved = 0;
  let writes = 0;

  const unresolved = [];
  const perKeyWrites = new Map();

  for (const t of tables) {
    const heading = t.heading_raw || "";
    const id = resolveHeadingToId(heading);

    if (!id || !targetDb[id]) {
      tablesUnresolved++;
      if (unresolved.length < 80) unresolved.push({ title: t.title, page: t.page, heading_raw: heading, heading_method: t.heading_method });
      continue;
    }

    let wroteThisTable = 0;

    for (const r of (t.nutrient_rows || [])) {
      const key = r.key;
      if (!key) continue;
      const v = firstNumber(r.values);
      if (v === null) continue;

      // do not overwrite display_name/category
      if (key === "display_name" || key === "category") continue;

      targetDb[id][key] = v;
      wroteThisTable++;
      writes++;
      perKeyWrites.set(key, (perKeyWrites.get(key) || 0) + 1);
    }

    if (wroteThisTable > 0) tablesApplied++;
  }

  // stamp lock meta (do not remove anything)
  if (structuredDb._LOCK && typeof structuredDb._LOCK === "object") {
    structuredDb._LOCK.last_applied_tables = path.basename(tablesPath);
    structuredDb._LOCK.last_applied_at = new Date().toISOString();
    structuredDb._LOCK.note = (structuredDb._LOCK.note || "") + " | nutrients populated from parsed BR tables (v1, first numeric per row).";
  }

  writeJson(dbPath, structuredDb);

  console.log("✅ Updated DB:", dbPath);
  console.log("tables_total:", tables.length);
  console.log("tables_applied_with_writes:", tablesApplied);
  console.log("tables_unresolved:", tablesUnresolved);
  console.log("total_field_writes:", writes);

  console.log("Top 40 keys written:");
  for (const [k, n] of Array.from(perKeyWrites.entries()).sort((a,b)=>b[1]-a[1]).slice(0,40)) {
    console.log(n, k);
  }

  if (unresolved.length) {
    const outUn = path.resolve("tools", "br_unresolved_tables.sample.json");
    writeJson(outUn, { sample: unresolved });
    console.log("⚠️ Wrote unresolved sample:", outUn);
  }
}

main();
