"use strict";

const fs = require("fs");
const path = require("path");

/**
 * tools/apply_br_tables_to_structured_db_v2_rows.cjs
 *
 * v2.7 — TABLE-HEADING MODE + SCOPE FILTER + CLEAN METRICS
 *
 * v7c/v7f structure:
 * - table.heading_raw / heading_norm identifies ingredient/feedstuff (when present)
 * - nutrient_rows: label_raw is nutrient name, key is nutrient key, values contains value + extras
 *
 * Apply (default):
 * 1) Only ingest Chapter 1 feedstuff composition tables (table_no starts with "1.")
 *    (Override: set env BR_APPLY_ALL_TABLES=1 to ingest everything)
 * 2) Resolve ingredient ID once per table using heading_raw (fallback title)
 * 3) Write first numeric value from each nutrient_row to that ingredient using r.key
 *
 * Key fix:
 * - Tables without headings (or non-feedstuff tables) should be SKIPPED, not treated as unresolved ingredients.
 */

function readJson(p) {
  let raw = fs.readFileSync(p, "utf8");
  if (raw && raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function stripDiacritics(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function norm(s) {
  let x = String(s || "").toLowerCase();
  x = x.replace(/\u00a0/g, " ");
  x = stripDiacritics(x);

  x = x.replace(/[(),;:]/g, " ");
  x = x.replace(/[\/\\|]/g, " ");
  x = x.replace(/[\[\]\{\}]/g, " ");
  x = x.replace(/[_+=]/g, " ");
  x = x.replace(/-/g, " ");

  x = x.replace(/[^\w\s\.%]/g, " ");
  x = x.replace(/\s+/g, " ").trim();

  const stop = new Set(["de", "da", "do", "das", "dos", "e", "em", "para", "com", "sem"]);
  const toks = x.split(" ").filter(Boolean).filter((t) => !stop.has(t));
  return toks.join(" ").trim();
}

function firstNumber(arr) {
  if (!Array.isArray(arr)) return null;
  for (const x of arr) {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function buildResolvers(structuredDb, ingredientAliasesNode, labelAliasesNode) {
  const labelAliasToId = new Map();
  for (const [k, v] of Object.entries(labelAliasesNode || {})) {
    const nk = norm(k);
    const id = String(v || "").trim();
    if (!nk || !id) continue;
    labelAliasToId.set(nk, id);
  }

  const ingredientAliasToId = new Map();
  for (const [k, v] of Object.entries(ingredientAliasesNode || {})) {
    const nk = norm(k);
    const id = String(v || "").trim();
    if (!nk || !id) continue;
    ingredientAliasToId.set(nk, id);
  }

  const nameToId = new Map();
  for (const [id, row] of Object.entries(structuredDb || {})) {
    const dn = row && row.display_name ? String(row.display_name) : "";
    const ndn = norm(dn);
    if (ndn && !nameToId.has(ndn)) nameToId.set(ndn, id);
  }

  function resolveLabelToId(labelRaw) {
    const n = norm(labelRaw);
    if (!n) return null;

    if (labelAliasToId.has(n)) return labelAliasToId.get(n);
    if (ingredientAliasToId.has(n)) return ingredientAliasToId.get(n);
    if (nameToId.has(n)) return nameToId.get(n);

    // contains-best display_name
    let best = null, bestLen = -1;
    for (const [ndn, id] of nameToId.entries()) {
      if (ndn.length < 5) continue;
      if (n.includes(ndn) && ndn.length > bestLen) {
        best = id;
        bestLen = ndn.length;
      }
    }
    if (best) return best;

    // contains-best label alias
    let bestLA = null, bestLALen = -1;
    for (const [ak, id] of labelAliasToId.entries()) {
      if (ak.length < 5) continue;
      if (n.includes(ak) && ak.length > bestLALen) {
        bestLA = id;
        bestLALen = ak.length;
      }
    }
    if (bestLA) return bestLA;

    // contains-best ingredient alias
    let bestIA = null, bestIALen = -1;
    for (const [ak, id] of ingredientAliasToId.entries()) {
      if (ak.length < 5) continue;
      if (n.includes(ak) && ak.length > bestIALen) {
        bestIA = id;
        bestIALen = ak.length;
      }
    }
    return bestIA;
  }

  return { resolveLabelToId };
}

function pickRowArray(table) {
  let best = null;
  let bestScore = -1;

  for (const k of Object.keys(table || {})) {
    const v = table[k];
    if (!Array.isArray(v) || v.length < 1) continue;
    const x = v[0];
    if (!x || typeof x !== "object") continue;

    const hasKey = Object.prototype.hasOwnProperty.call(x, "key");
    const hasValues = Object.prototype.hasOwnProperty.call(x, "values");
    const hasLabel =
      Object.prototype.hasOwnProperty.call(x, "label_raw") ||
      Object.prototype.hasOwnProperty.call(x, "label_norm");

    let score = 0;
    if (hasKey) score += 5;
    if (hasValues) score += 5;
    if (hasLabel) score += 3;
    score += Math.min(v.length, 500) / 50;

    if (score > bestScore) {
      bestScore = score;
      best = { key: k, arr: v };
    }
  }
  return best;
}

function isFeedstuffCompositionTable(t) {
  // Default: only chapter 1 (feedstuff chemical composition/energy tables)
  // Override: BR_APPLY_ALL_TABLES=1 to ingest everything
  if (String(process.env.BR_APPLY_ALL_TABLES || "") === "1") return true;

  const tno = String(t.table_no || "").trim();
  if (!tno) return false;
  return /^1\./.test(tno);
}

function main() {
  const tablesPath = process.argv[2] || path.resolve("tools", "br_tables_parsed.v7c.json");

  const dbPath = path.resolve(
    "core",
    "db",
    "ingredients",
    "poultry",
    "br",
    "v1",
    "ingredients.poultry.br.sid.v1.json"
  );
  const aliPath = path.resolve("core", "db", "aliases", "poultry", "br", "v1", "aliases.poultry.br.v1.json");
  const labelAliPath = path.resolve(
    "core",
    "db",
    "ingredients",
    "poultry",
    "br",
    "v1",
    "aliases.poultry.br.labels.v1.json"
  );

  const jTables = readJson(tablesPath);
  const tables = jTables.tables || [];

  const structured = readJson(dbPath);
  const targetDb = structured.db ? structured.db : structured;

  const aliasesJ = readJson(aliPath);
  const ingredientAliasesNode = aliasesJ.aliases || aliasesJ.db || aliasesJ.map || {};

  let labelAliasesNode = {};
  if (fs.existsSync(labelAliPath)) {
    const la = readJson(labelAliPath);
    labelAliasesNode = la.map || la.aliases || la.db || la || {};
  }

  const { resolveLabelToId } = buildResolvers(targetDb, ingredientAliasesNode, labelAliasesNode);

  let writes = 0;

  // row counters
  let rowsSeen = 0;
  let rowsResolved = 0;
  let rowsUnresolved = 0;

  let rowsSkippedKeyMissing = 0;
  let rowsSkippedNoNumeric = 0;
  let rowsSkippedNoHeading = 0;

  // table counters
  let tablesConsidered = 0;
  let tablesSkippedOutOfScope = 0;

  let tablesWithHeading = 0;
  let tablesHeadingResolved = 0;
  let tablesHeadingUnresolved = 0;
  let tablesSkippedNoHeading = 0;

  const perKeyWrites = new Map();
  const unresolved = [];

  let pickedArrayKey = null;

  for (const t of tables) {
    tablesConsidered++;

    // scope filter
    if (!isFeedstuffCompositionTable(t)) {
      tablesSkippedOutOfScope++;
      continue;
    }

    const picked = pickRowArray(t);
    if (!picked) continue;
    if (!pickedArrayKey) pickedArrayKey = picked.key;

    const rows = picked.arr;

    const heading = t.heading_raw || t.heading_norm || "";
    const title = t.title || "";
    const tableLabel = heading || title;

    if (tableLabel) tablesWithHeading++;

    let tableIngredientId = null;

    // If no usable table label, skip this table (don’t count as unresolved rows)
    if (!tableLabel) {
      tablesSkippedNoHeading++;
      rowsSkippedNoHeading += rows.length;
      continue;
    }

    const id = resolveLabelToId(tableLabel);
    if (id && targetDb[id]) {
      tableIngredientId = id;
      tablesHeadingResolved++;
    } else {
      tablesHeadingUnresolved++;

      // For our ingestion mode, if table heading cannot map -> skip rows
      // (row labels are nutrients, not ingredients, so fallback is noise)
      rowsSkippedNoHeading += rows.length;

      if (unresolved.length < 250) {
        unresolved.push({
          mode: "table_heading_unresolved",
          table: t.title || "(unknown)",
          page: t.page ?? null,
          table_no: t.table_no ?? null,
          heading_raw: t.heading_raw ?? null,
          heading_norm: t.heading_norm ?? null,
          heading_method: t.heading_method ?? null
        });
      }
      continue;
    }

    // Write nutrients to the resolved ingredient
    for (const r of rows) {
      rowsSeen++;

      const key = r.key || "";
      if (!key) {
        rowsSkippedKeyMissing++;
        continue;
      }

      const v = firstNumber(r.values);
      if (v === null) {
        rowsSkippedNoNumeric++;
        continue;
      }

      if (key === "display_name" || key === "category") continue;

      targetDb[tableIngredientId][key] = v;
      rowsResolved++;
      writes++;
      perKeyWrites.set(key, (perKeyWrites.get(key) || 0) + 1);
    }
  }

  if (structured._LOCK && typeof structured._LOCK === "object") {
    structured._LOCK.last_applied_tables = path.basename(tablesPath);
    structured._LOCK.last_applied_at = new Date().toISOString();
    structured._LOCK.last_apply_mode = "ROW_AUTO_DETECT_v2_7_TABLE_HEADING_SCOPEFILTER";
    structured._LOCK.last_apply_rows_array_key = pickedArrayKey;
    structured._LOCK.last_apply_label_alias_file = fs.existsSync(labelAliPath) ? path.basename(labelAliPath) : null;
    structured._LOCK.note =
      (structured._LOCK.note || "") +
      " | populated from BR tables (v2.7 table-heading mode + scope filter + clean metrics).";
  }

  writeJson(dbPath, structured);

  console.log(" Updated DB:", dbPath);
  console.log("tables_total:", tables.length);
  console.log("tables_considered:", tablesConsidered);
  console.log("tables_skipped_out_of_scope:", tablesSkippedOutOfScope);
  console.log("rows_seen:", rowsSeen);
  console.log("tables_with_heading_or_title:", tablesWithHeading);
  console.log("tables_skipped_no_heading:", tablesSkippedNoHeading);
  console.log("tables_heading_resolved:", tablesHeadingResolved);
  console.log("tables_heading_unresolved:", tablesHeadingUnresolved);
  console.log("rows_resolved:", rowsResolved);
  console.log("rows_unresolved:", rowsUnresolved);
  console.log("rows_skipped_no_heading:", rowsSkippedNoHeading);
  console.log("rows_skipped_key_missing:", rowsSkippedKeyMissing);
  console.log("rows_skipped_no_numeric:", rowsSkippedNoNumeric);
  console.log("total_field_writes:", writes);
  console.log("picked_rows_array_key:", pickedArrayKey);
  console.log("BR_APPLY_ALL_TABLES:", String(process.env.BR_APPLY_ALL_TABLES || "") === "1" ? "1 (ON)" : "0 (default)");

  console.log("Top 40 keys written:");
  for (const [k, n] of Array.from(perKeyWrites.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    console.log(n, k);
  }

  if (unresolved.length) {
    const outUn = path.resolve("tools", "br_unresolved_rows.sample.json");
    writeJson(outUn, { sample: unresolved });
    console.log(" Wrote unresolved sample:", outUn);
  } else {
    console.log(" No unresolved sample written (none).");
  }
}

main();