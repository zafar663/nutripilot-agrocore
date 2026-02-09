import { excelToFormulaText } from "./excelToFormulaText.js";

export function ingestFileToFormulaText({ buffer, contentType, filename }) {
  const lowerName = (filename || "").toLowerCase();

  const isXlsx =
    (contentType || "").includes("spreadsheet") ||
    (contentType || "").includes("excel") ||
    lowerName.endsWith(".xlsx");

  if (isXlsx) {
    const r = excelToFormulaText(buffer);
    return {
      status: r.formula_text ? "OK" : "ERROR",
      content_type: contentType || "unknown",
      detected: { format: "xlsx" },
      ...r,
    };
  }

  // v1: only xlsx supported
  return {
    status: "ERROR",
    content_type: contentType || "unknown",
    confidence: "low",
    detected: { format: "unknown" },
    formula_text: "",
    warnings: ["Only Excel (.xlsx) is supported right now. Upload an .xlsx or paste text."],
  };
}
