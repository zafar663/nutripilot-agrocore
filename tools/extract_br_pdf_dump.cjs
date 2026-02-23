"use strict";

/**
 * tools/extract_br_pdf_dump.cjs
 *
 * Node-only PDF text dump extractor (no Python).
 * Produces a JSON with:
 *   - meta
 *   - full_text_head (first N chars)
 *   - pages[]: { page, text_head, text_len, lines_sample[] }
 *
 * NOTE:
 * pdf-parse does not always preserve page boundaries perfectly.
 * We still dump a "global" text and also attempt a page split heuristic.
 *
 * Usage:
 *   node tools/extract_br_pdf_dump.cjs "<pdf_path>" "<out_json_path>"
 */

const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function normLine(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/**
 * Heuristic split into "pages" using form feed OR repeated "Table" headers.
 * This won't be perfect, but it's enough to:
 *  - find labels
 *  - build mapping rules
 *  - confirm text is extractable
 */
function splitIntoPseudoPages(text) {
  // First try formfeed split
  if (text.includes("\f")) {
    const parts = text.split("\f").map(x => x.trim()).filter(Boolean);
    if (parts.length >= 5) return parts;
  }

  // Fallback: split by repeated "Table " occurrences (keeps delimiter)
  const re = /(Table\s+\d+\.\d+[\s\S]*?)(?=Table\s+\d+\.\d+|$)/gi;
  const pages = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const chunk = (m[1] || "").trim();
    if (chunk.length > 200) pages.push(chunk);
  }
  if (pages.length >= 5) return pages;

  // Last fallback: fake single page
  return [text];
}

async function main() {
  const pdfPath = process.argv[2];
  const outPath = process.argv[3];

  if (!pdfPath || !outPath) {
    console.error('Usage: node tools/extract_br_pdf_dump.cjs "<pdf_path>" "<out_json_path>"');
    process.exit(1);
  }

  if (!fs.existsSync(pdfPath)) {
    console.error("PDF not found:", pdfPath);
    process.exit(1);
  }

  const dataBuffer = fs.readFileSync(pdfPath);

  const parsed = await pdfParse(dataBuffer);
  const text = parsed.text || "";

  const pseudoPages = splitIntoPseudoPages(text);

  const pages = pseudoPages.map((p, idx) => {
    const lines = String(p).split(/\r?\n/).map(normLine).filter(Boolean);
    return {
      page: idx + 1,
      text_len: p.length,
      text_head: lines.slice(0, 60).join("\n"),
      lines_sample: lines.slice(0, 120)
    };
  });

  const out = {
    _meta: {
      pdf: pdfPath,
      extracted_at: new Date().toISOString(),
      engine: "node+pdf-parse",
      pdf_info: {
        numpages: parsed.numpages,
        numrender: parsed.numrender,
        info: parsed.info || null,
        metadata_present: !!parsed.metadata
      },
      note:
        "Pseudo-pages are heuristic. This dump is used to discover labels and build mapping rules before structured parsing."
    },
    full_text_len: text.length,
    full_text_head: text.slice(0, 3000),
    pages
  };

  writeJson(outPath, out);

  console.log("✅ Wrote:", outPath);
  console.log("full_text_len:", text.length);
  console.log("pdf_numpages:", parsed.numpages);
  console.log("pseudo_pages:", pages.length);
}

main().catch(err => {
  console.error("❌ Extract failed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
