import * as XLSX from "xlsx";

export function excelToFormulaText(buffer) {
  const warnings = [];

  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName) {
    return { formula_text: "", confidence: "low", warnings: ["Excel file has no sheets."] };
  }

  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  const lines = [];

  for (const r of rows) {
    if (!r || r.length < 2) continue;

    const name = String(r[0] ?? "").trim();
    if (!name) continue;

    // Skip common headers
    const low = name.toLowerCase();
    if (low.includes("ingredient") || low.includes("raw material")) continue;

    const rawVal = r[1];
    const num =
      typeof rawVal === "number"
        ? rawVal
        : parseFloat(String(rawVal).replace("%", "").trim());

    if (!Number.isFinite(num)) continue;

    lines.push(`${name} ${num}`);
  }

  if (lines.length === 0) {
    warnings.push("No ingredient rows detected. Put Ingredient in column A and % in column B.");
    return { formula_text: "", confidence: "low", warnings };
  }

  return {
    formula_text: lines.join("\n"),
    confidence: lines.length >= 5 ? "high" : "med",
    warnings,
  };
}
