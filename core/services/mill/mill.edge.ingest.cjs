"use strict";

/** Server-side reading of mill-edge uploads. This file is not in the mill download. */

function splitLine(line, delim) {
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

function headerKey(h) {
  return String(h || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

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

function rowsOf(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "").replace(/\r/g, "");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const delim = detectDelim(lines[0]);
  const table = lines.map((l) => splitLine(l, delim));
  const headers = table[0].map(headerKey);
  return { headers, data: table.slice(1), delim };
}

function col(headers, ...aliases) {
  for (const a of aliases) {
    const i = headers.indexOf(headerKey(a));
    if (i >= 0) return i;
  }
  return -1;
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
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

function xmlBatch(text, filename) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const batch = xmlInner(raw, "BatchNumber") || xmlInner(raw, "batch_number") || xmlInner(raw, "RecipeCode") || String(filename || "").replace(/\.[^.]+$/, "");
  const formula = xmlInner(raw, "RecipeName") || xmlInner(raw, "formula_name") || xmlInner(raw, "Formula");
  const unit = xmlInner(raw, "Unit") || "kg";
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
      planned_kg: planned === "" ? undefined : num(planned),
      actual_kg: num(actual === "" ? planned : actual),
      unit,
    });
  }
  if (!actuals.length) return { error: "No ingredient lines in the batch file" };
  if (!batch) return { error: "No batch id in the batch file" };
  return { body: { batch_number: batch, formula_name: formula || undefined, unit, actuals } };
}

function csvBatch(text, filename) {
  const parsed = rowsOf(text);
  if (!parsed) return { error: "Empty batch file" };
  const { headers, data } = parsed;
  const iBatch = col(headers, "batch_number", "batch", "batch_id", "lot", "lot_no", "lotno", "mix", "mix_no", "job", "ticket", "ticket_no");
  const iFormula = col(headers, "formula_name", "formula", "recipe", "diet", "product", "feed", "ration");
  const iCode = col(headers, "code", "ingredient_id", "ingredient_code", "item", "sku", "rm_code", "raw_code", "component", "ing_code", "mat_code");
  const iName = col(headers, "name", "ingredient_name", "ingredient", "material", "raw_material", "description", "item_name");
  const iActual = col(headers, "actual_kg", "actual", "actual_weight", "dosed", "weighed", "qty", "quantity", "weight", "wt", "act_qty", "used");
  const iPlan = col(headers, "planned_kg", "target", "target_kg", "setpoint", "recipe_kg", "set", "req", "required", "plan");
  const iUnit = col(headers, "unit", "uom", "units");
  const headerless = iActual < 0 && (iCode < 0 && iName < 0);
  const actuals = [];
  let batch = "";
  let formula = "";
  const source = headerless ? [headers, ...data] : data;
  for (const cells of source) {
    const b = headerless ? cells[0] : (iBatch >= 0 ? cells[iBatch] : "");
    const f = headerless ? cells[1] : (iFormula >= 0 ? cells[iFormula] : "");
    const code = headerless ? cells[2] : (iCode >= 0 ? cells[iCode] : "");
    const name = headerless ? cells[3] : (iName >= 0 ? cells[iName] : "");
    const planned = headerless ? cells[4] : (iPlan >= 0 ? cells[iPlan] : "");
    const actual = headerless ? cells[5] : (iActual >= 0 ? cells[iActual] : "");
    const unit = headerless ? (cells[6] || "") : (iUnit >= 0 ? cells[iUnit] : "");
    if (b) batch = b;
    if (f) formula = f;
    if (!code && !name) continue;
    if (actual === "" && planned === "") continue;
    actuals.push({
      ingredient_id: code || name,
      ingredient_name: name || code,
      planned_kg: planned === "" ? undefined : num(planned),
      actual_kg: num(actual === "" ? planned : actual),
      unit,
    });
  }
  if (!batch && filename) batch = String(filename).replace(/\.[^.]+$/, "");
  if (!actuals.length) return { error: "No ingredient lines in the batch file" };
  if (!batch) return { error: "No batch id in the batch file" };
  return { body: { batch_number: batch, formula_name: formula || undefined, actuals } };
}

function csvObject(text, fields) {
  const parsed = rowsOf(text);
  if (!parsed || !parsed.data.length) return { error: "Empty file" };
  const { headers, data } = parsed;
  const cells = data[0];
  const obj = {};
  for (const [key, aliases] of Object.entries(fields)) {
    const i = col(headers, ...aliases);
    if (i >= 0 && cells[i] !== "") obj[key] = cells[i];
  }
  if (!Object.keys(obj).length) return { error: "File headers were not recognized" };
  return { body: obj };
}

function csvLab(text, filename) {
  const parsed = rowsOf(text);
  if (!parsed) return { error: "Empty lab file" };
  const { headers, data } = parsed;
  const iBatch = col(headers, "batch_number", "batch", "lot");
  const iName = col(headers, "nutrient", "name", "code", "analyte");
  const iVal = col(headers, "value", "result", "pct", "amount");
  let batch = "";
  const nutrients = {};
  if (iName >= 0 && iVal >= 0) {
    for (const cells of data) {
      if (iBatch >= 0 && cells[iBatch]) batch = cells[iBatch];
      const name = headerKey(cells[iName]);
      const value = num(cells[iVal]);
      if (name && value != null) nutrients[name] = value;
    }
  } else {
    const wide = {};
    for (let i = 0; i < headers.length; i++) {
      if (["batch_number", "batch", "lot", "lab_ref"].includes(headers[i])) {
        if (data[0] && data[0][i]) batch = data[0][i];
        continue;
      }
      const value = data[0] ? num(data[0][i]) : null;
      if (headers[i] && value != null) wide[headers[i]] = value;
    }
    Object.assign(nutrients, wide);
  }
  if (!batch && filename) batch = String(filename).replace(/\.[^.]+$/, "");
  if (!Object.keys(nutrients).length) return { error: "No lab values in the file" };
  return { body: { batch_number: batch, nutrients } };
}

function fromText(kind, text, filename) {
  const trim = String(text || "").trim();
  if (!trim) return { error: "Empty file" };
  if (trim.startsWith("{") || trim.startsWith("[")) {
    try { return { body: JSON.parse(trim) }; } catch { return { error: "File is not valid JSON" }; }
  }
  if (kind === "batch" && trim.startsWith("<")) return xmlBatch(trim, filename);
  if (kind === "batch") return csvBatch(trim, filename);
  if (kind === "lab") return csvLab(trim, filename);
  if (kind === "weighbridge") {
    return csvObject(trim, {
      ingredient_id: ["ingredient_id", "code", "item", "sku"],
      ingredient_name: ["ingredient_name", "name", "material", "ingredient"],
      supplier_name: ["supplier_name", "supplier", "vendor"],
      vehicle_id: ["vehicle_id", "vehicle", "truck", "plate"],
      driver_name: ["driver_name", "driver"],
      gross_weight: ["gross_weight", "gross", "gross_kg"],
      tare_weight: ["tare_weight", "tare", "tare_kg"],
      recorded_unit: ["unit", "uom"],
      moisture_pct: ["moisture_pct", "moisture"],
      protein_pct: ["protein_pct", "protein"],
      storage_bin: ["storage_bin", "bin", "silo"],
      receipt_date: ["receipt_date", "date"],
      receipt_number: ["receipt_number", "ticket", "receipt"],
      price_per_unit: ["price_per_unit", "price"],
      lot_number: ["lot_number", "lot", "supplier_lot"],
      photo_path: ["photo_path", "photo", "image"],
    });
  }
  if (kind === "process") {
    return csvObject(trim, {
      batch_number: ["batch_number", "batch", "lot"],
      grind_size_mm: ["grind_size_mm", "grind", "particle_size_mm"],
      conditioner_temp: ["conditioner_temp", "conditioner"],
      pellet_temp: ["pellet_temp", "pellet"],
      pdi_pct: ["pdi_pct", "pdi"],
      kwh_per_ton: ["kwh_per_ton", "kwh"],
      moisture_pct: ["moisture_pct", "moisture"],
      fines_pct: ["fines_pct", "fines"],
      protein_pct: ["protein_pct", "protein"],
    });
  }
  if (kind === "dispatch") {
    return csvObject(trim, {
      batch_number: ["batch_number", "batch", "lot"],
      customer_name: ["customer_name", "customer", "farm_name", "farm"],
      farm_id: ["farm_id", "farm"],
      quantity_tons: ["quantity_tons", "quantity", "tons", "mill_mass"],
      mill_mass: ["mill_mass", "net", "weight"],
      leftover_mass: ["leftover_mass", "leftover"],
      silo_bin: ["silo_bin", "bin", "silo"],
      vehicle_id: ["vehicle_id", "vehicle", "truck"],
      driver_name: ["driver_name", "driver"],
    });
  }
  return { error: "File was not recognized" };
}

function shapeEdgeUpload(kind, body, filename) {
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) return { body };
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "");
  return fromText(kind, text, filename);
}

module.exports = { shapeEdgeUpload };
