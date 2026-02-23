"use strict";

const fs = require("fs");
const path = require("path");

function readJson(p) {
  let raw = fs.readFileSync(p, "utf8");
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s\+\-\/\.%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeLabel(line) {
  const s = norm(line);
  if (!s) return false;
  if (s.length < 3) return false;
  if (s.startsWith("table ")) return false;
  if (/^\d+(\.\d+)?$/.test(s)) return false;
  if (!/[a-z]/.test(s)) return false;
  if (s.length > 90) return false;
  if (s.includes("equation") || s.includes("methodology") || s.includes("curves")) return false;
  return true;
}

function main() {
  const dumpPath = process.argv[2] || path.resolve("tools", "br_extracted_dump.json");
  const outPath  = process.argv[3] || path.resolve("tools", "br_detected_labels.json");

  if (!fs.existsSync(dumpPath)) {
    console.error("Dump not found:", dumpPath);
    process.exit(1);
  }

  const dump = readJson(dumpPath);

  // Only pages that smell like composition tables
  const keepIf = (txt) => {
    const t = (txt || "").toLowerCase();
    return (
      t.includes("amino acid") ||
      t.includes("amino acids") ||
      t.includes("sid") ||
      t.includes("chemical composition") ||
      t.includes("composition") ||
      t.includes("crude protein") ||
      t.includes("ether extract") ||
      t.includes("available phosphorus") ||
      t.includes("digestible phosphorus") ||
      t.includes("linoleic acid") ||
      t.includes("lysine") ||
      t.includes("methionine") ||
      t.includes("met. + cys") ||
      t.includes("met + cys")
    );
  };

  const counts = new Map();
  const pagesPicked = [];

  for (const p of (dump.pages || [])) {
    const joined = (p.lines_sample || []).join(" ");
    if (!keepIf(joined)) continue;

    const labels = [];
    for (const ln of (p.lines_sample || [])) {
      if (!looksLikeLabel(ln)) continue;

      // keep label before first number if present
      const m = String(ln).match(/^(.+?)(?=\s+\d)/);
      const rawLabel = m ? m[1] : ln;
      const label = norm(rawLabel);

      if (!label) continue;

      labels.push(label);
      counts.set(label, (counts.get(label) || 0) + 1);
    }

    if (labels.length) {
      pagesPicked.push({
        page: p.page,
        label_count: new Set(labels).size,
        labels: Array.from(new Set(labels)).slice(0, 300)
      });
    }
  }

  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1200)
    .map(([label, n]) => ({ label, n }));

  const out = {
    _meta: {
      dump: dumpPath,
      extracted_at: new Date().toISOString(),
      note: "Detected label candidates from likely ingredient composition pages."
    },
    top_labels: top,
    pages_with_labels: pagesPicked.sort((a,b)=>b.label_count-a.label_count).slice(0, 250)
  };

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log("✅ Wrote:", outPath);
  console.log("Dump pages:", (dump.pages || []).length);
  console.log("Pages scanned (kept):", pagesPicked.length);
  console.log("Unique labels:", top.length);
  console.log("Top 80 labels:");
  for (const r of top.slice(0, 80)) console.log(r.n, r.label);
}

main();
