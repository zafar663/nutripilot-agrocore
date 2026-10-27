/**
 * Brand-agnostic PLC report → Nutrix native JSON.
 * Map THEIR columns (name or 0-based index). Presets are shortcuts, not a requirement.
 */
export const PRESETS = {
  generic: {
    skip_rows: 0,
    has_header: true,
    delimiter: "auto",
    columns: { batch: "batch_number", formula: "formula_name", code: "code", name: "name", planned: "target_kg", actual: "actual_kg", unit: "unit" },
  },
  buhler: {
    skip_rows: 0,
    has_header: true,
    delimiter: ";",
    columns: { batch: "batch", formula: "recipe", code: "component", name: "name", planned: "setpoint", actual: "actual", unit: "unit" },
  },
  cpm: {
    skip_rows: 0,
    has_header: true,
    delimiter: ",",
    columns: { batch: "batch", formula: "formula", code: "ing_code", name: "description", planned: "target", actual: "actual", unit: "uom" },
  },
  vanaarsen: {
    skip_rows: 0,
    has_header: true,
    delimiter: "\t",
    columns: { batch: "lot", formula: "diet", code: "code", name: "raw_material", planned: "set", actual: "dosed", unit: "unit" },
  },
  /** Typical homemade SCADA: no header, fixed column order. Edit indexes to match the mill. */
  local_headerless: {
    skip_rows: 0,
    has_header: false,
    delimiter: ",",
    columns: { batch: 0, formula: 1, code: 2, name: 3, planned: 4, actual: 5, unit: 6 },
  },
};

function detectDelim(line) {
  const counts = [
    ["\t", (line.match(/\t/g) || []).length],
    [";", (line.match(/;/g) || []).length],
    ["|", (line.match(/\|/g) || []).length],
    [",", (line.match(/,/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

export function splitLine(line, delim) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { q = !q; continue; }
    if (!q && ch === delim) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function normHead(h) {
  return String(h || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function cell(cells, spec, headers) {
  if (spec == null || spec === "") return "";
  if (typeof spec === "number") return cells[spec] ?? "";
  const want = normHead(spec);
  const i = headers.findIndex((h) => h === want);
  return i >= 0 ? (cells[i] ?? "") : "";
}

/**
 * Turn a PLC file into { batch_number, formula_name, actuals: [...] }.
 * mapCfg: skip_rows, has_header, delimiter, columns, batch_from_filename
 */
export function fileToNative(text, filename, mapCfg = {}) {
  const skip = Number(mapCfg.skip_rows) || 0;
  const hasHeader = mapCfg.has_header !== false;
  let raw = String(text || "").replace(/^\uFEFF/, "").replace(/\r/g, "");
  let lines = raw.split("\n").map((l) => l.trimEnd()).filter((l, i) => i >= skip && String(l).trim());
  if (!lines.length) throw new Error("Empty report");

  const delim = mapCfg.delimiter && mapCfg.delimiter !== "auto"
    ? (mapCfg.delimiter === "\\t" ? "\t" : mapCfg.delimiter)
    : detectDelim(lines[0]);

  let headers = [];
  let dataLines = lines;
  if (hasHeader) {
    headers = splitLine(lines[0], delim).map(normHead);
    dataLines = lines.slice(1);
  }

  const cols = mapCfg.columns || PRESETS.generic.columns;
  const actuals = [];
  let batch = "";
  let formula = "";
  for (const line of dataLines) {
    const cells = splitLine(line, delim);
    if (!cells.some((c) => c !== "")) continue;
    const b = cell(cells, cols.batch, headers);
    const f = cell(cells, cols.formula, headers);
    if (b) batch = b;
    if (f) formula = f;
    const code = cell(cells, cols.code, headers);
    const name = cell(cells, cols.name, headers);
    const planned = cell(cells, cols.planned, headers);
    const actual = cell(cells, cols.actual, headers);
    const unit = cell(cells, cols.unit, headers) || mapCfg.mill_unit || "";
    if (!code && !name) continue;
    if (actual === "" && planned === "") continue;
    actuals.push({
      ingredient_id: code || name,
      ingredient_name: name || code,
      planned_kg: planned === "" ? undefined : Number(String(planned).replace(/,/g, "")),
      actual_kg: Number(String(actual === "" ? planned : actual).replace(/,/g, "")),
      unit,
    });
  }
  if (mapCfg.batch_from_filename || !batch) {
    const stem = String(filename || "").replace(/\.[^.]+$/, "");
    if (stem && !batch) batch = stem;
  }
  if (!actuals.length) throw new Error("No ingredient lines after mapping — check columns in config.json");
  if (!batch) throw new Error("No batch id — map columns.batch or use batch_from_filename: true");
  return {
    batch_number: batch,
    formula_name: formula || undefined,
    unit: mapCfg.mill_unit || undefined,
    actuals,
  };
}

function xmlInner(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = String(xml || "").match(re);
  return m ? String(m[1]).replace(/<[^>]+>/g, "").trim() : "";
}

function xmlBlocks(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "ig");
  return [...String(xml || "").matchAll(re)].map((m) => m[1]);
}

/** ISA-88 / Mill IQ Recipe XML → native batch actuals. */
export function xmlToNative(text, filename, millUnit = "") {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const batch =
    xmlInner(raw, "BatchNumber") ||
    xmlInner(raw, "batch_number") ||
    xmlInner(raw, "RecipeCode") ||
    String(filename || "").replace(/\.[^.]+$/, "");
  const formula = xmlInner(raw, "RecipeName") || xmlInner(raw, "formula_name") || xmlInner(raw, "Formula");
  const unit = xmlInner(raw, "Unit") || millUnit || "kg";
  const actuals = [];
  for (const block of xmlBlocks(raw, "Ingredient")) {
    const code = xmlInner(block, "Code") || xmlInner(block, "ingredient_id");
    const name = xmlInner(block, "Name") || xmlInner(block, "ingredient_name");
    const planned = xmlInner(block, "PlannedKG") || xmlInner(block, "Weight") || xmlInner(block, "target_kg");
    const actual = xmlInner(block, "ActualKG") || xmlInner(block, "actual_kg") || planned;
    if (!code && !name) continue;
    if (actual === "" && planned === "") continue;
    actuals.push({
      ingredient_id: code || name,
      ingredient_name: name || code,
      planned_kg: planned === "" ? undefined : Number(String(planned).replace(/,/g, "")),
      actual_kg: Number(String(actual === "" ? planned : actual).replace(/,/g, "")),
      unit,
    });
  }
  if (!actuals.length) throw new Error("No ingredient lines in XML");
  if (!batch) throw new Error("No batch id in XML");
  return { batch_number: batch, formula_name: formula || undefined, unit, actuals };
}

export function inspectFile(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "").replace(/\r/g, "");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8);
  if (!lines.length) return { error: "empty" };
  const delim = detectDelim(lines[0]);
  const preview = lines.map((l) => splitLine(l, delim));
  return {
    delimiter: delim === "\t" ? "tab" : delim,
    columns_in_first_row: preview[0].length,
    first_row: preview[0],
    sample_rows: preview,
    hint: "If first_row looks like titles, set has_header true and columns to those names. If it looks like data, set has_header false and columns to 0,1,2…",
  };
}
