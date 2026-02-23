// nutripilot-agrocore/core/ingest/ingestFileToFormulaText.js

import pdf from "pdf-parse";
import { excelToFormulaText } from "./excelToFormulaText.js";

const INGEST_VERSION = "pdf_ingest_v10_PRODUCTION_LOCKED_2026-02-12";

const BAD_NAMES = new Set([
  "poor","low","non-abbr","values","min","max","target","actual","total"
]);

// ---------- Helpers ----------

function normalizeLines(rawText) {
  return String(rawText || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);
}

function toNum(s) {
  const n = Number(String(s || "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function cleanKey(s) {
  return String(s || "").toLowerCase().replace(/\s+/g," ").trim();
}

function sanitizeIngredientName(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  s = s.replace(/\s+\d{1,3}(?:-\d{1,3})?%$/g, "");
  return s.trim();
}

// ---------- RATIO-STYLE REPORT PARSER ----------

function parseReportStyle(lines) {
  const rows = [];

  for (const line of lines) {

    if (/^total\b/i.test(line)) break;

    // Example pattern: Maize 27.45 274.50
    const m = line.match(/^(.+?)\s+(\d{1,3}\.\d{1,4})\s+(\d{1,6}\.\d{1,4})$/);

    if (!m) continue;

    const name = sanitizeIngredientName(m[1]);
    const pct = toNum(m[2]);

    if (!name) continue;
    if (!pct || pct <= 0) continue;
    if (BAD_NAMES.has(cleanKey(name))) continue;

    rows.push({ ing: name, pct });
  }

  if (rows.length < 3) return null;

  return {
    formula_text: rows.map(r => `${r.ing} ${r.pct}`).join("\n"),
    confidence: "high",
    warnings: [],
    meta: {
      version: INGEST_VERSION,
      mode: "report_style",
      rows: rows.length
    }
  };
}

// ---------- SIMPLE PAIR PARSER ----------

function parseSimplePairs(lines) {
  const rows = [];

  for (const line of lines) {

    if (/^total\b/i.test(line)) break;

    const m = line.match(/^(.+?)\s+(-?\d+(?:\.\d+)?)$/);
    if (!m) continue;

    const name = sanitizeIngredientName(m[1]);
    const pct = toNum(m[2]);

    if (!name) continue;
    if (!pct || pct <= 0) continue;
    if (BAD_NAMES.has(cleanKey(name))) continue;

    rows.push({ ing: name, pct });
  }

  if (rows.length < 2) return null;

  return {
    formula_text: rows.map(r => `${r.ing} ${r.pct}`).join("\n"),
    confidence: "medium",
    warnings: [],
    meta: {
      version: INGEST_VERSION,
      mode: "simple_pairs",
      rows: rows.length
    }
  };
}

// ---------- LOOSE FALLBACK PARSER ----------

function parseLoose(lines) {
  const rows = [];

  for (const line of lines) {

    const m = line.match(/([A-Za-z][A-Za-z\s\-\/]+)\s+(\d{1,3}\.\d{1,4})/);
    if (!m) continue;

    const name = sanitizeIngredientName(m[1]);
    const pct = toNum(m[2]);

    if (!name) continue;
    if (!pct || pct <= 0) continue;
    if (BAD_NAMES.has(cleanKey(name))) continue;

    rows.push({ ing: name, pct });
  }

  if (rows.length < 2) return null;

  return {
    formula_text: rows.map(r => `${r.ing} ${r.pct}`).join("\n"),
    confidence: "low",
    warnings: ["Loose parsing used."],
    meta: {
      version: INGEST_VERSION,
      mode: "loose",
      rows: rows.length
    }
  };
}

// ---------- MAIN PDF PARSER ----------

function parsePdfToFormulaText(rawText) {

  const lines = normalizeLines(rawText);

  let result = parseReportStyle(lines);
  if (result) return result;

  result = parseSimplePairs(lines);
  if (result) return result;

  result = parseLoose(lines);
  if (result) return result;

  return {
    formula_text: "",
    confidence: "low",
    warnings: ["PDF parse failed."],
    meta: {
      version: INGEST_VERSION,
      mode: "failed"
    }
  };
}

// ---------- MAIN EXPORT ----------

export async function ingestFileToFormulaText(fileBuffer, fileInfo = {}) {

  const filename = String(fileInfo.filename || "");
  const contentType = String(fileInfo.contentType || "");

  if (contentType.includes("spreadsheet") || filename.toLowerCase().endsWith(".xlsx")) {
    return await excelToFormulaText(fileBuffer);
  }

  if (contentType.includes("pdf") || filename.toLowerCase().endsWith(".pdf")) {
    try {
      const parsed = await pdf(fileBuffer);
      return parsePdfToFormulaText(parsed?.text || "");
    } catch (err) {
      return {
        formula_text: "",
        confidence: "low",
        warnings: [`PDF extract error: ${err.message}`],
        meta: {
          version: INGEST_VERSION,
          mode: "pdf_error"
        }
      };
    }
  }

  const txt = Buffer.from(fileBuffer).toString("utf8");

  return {
    formula_text: txt,
    confidence: txt ? "medium" : "low",
    warnings: [],
    meta: {
      version: INGEST_VERSION,
      mode: "text"
    }
  };
}
