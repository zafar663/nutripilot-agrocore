import { excelToFormulaText } from "./excelToFormulaText.js";

export function ingestFileToFormulaText({ buffer, contentType, filename }) {
  const lowerName = (filename || "").toLowerCase();
  const ct = (contentType || "").toLowerCase();

  const isXlsx =
    ct.includes("spreadsheet") ||
    ct.includes("excel") ||
    lowerName.endsWith(".xlsx");

  // NEW: text support
  const isText =
    ct.startsWith("text/") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".csv");

  if (isText) {
    const formula_text = Buffer.from(buffer).toString("utf8").trim();
    return {
      status: formula_text ? "OK" : "ERROR",
      content_type: contentType || "unknown",
      detected: { format: "text" },
      formula_text,
      warnings: formula_text ? [] : ["Empty text file."]
    };
  }

  if (isXlsx) {
    const r = excelToFormulaText(buffer);
    return {
      status: r.formula_text ? "OK" : "ERROR",
      content_type: contentType || "unknown",
      detected: { format: "xlsx" },
      ...r
    };
  }

  return {
    status: "ERROR",
    content_type: contentType || "unknown",
    confidence: "low",
    detected: { format: "unknown" },
    formula_text: "",
    warnings: [
      "Supported: .txt/.csv (text) and .xlsx (Excel). Upload one of these, or paste text."
    ]
  };
}
