"use strict";

const fs = require("fs");
const path = require("path");

function readJson(p) {
  let raw = fs.readFileSync(p, "utf8");
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}

function scorePage(lines) {
  const t = (lines || []).join(" ").toLowerCase();

  const hits = [
    ["ingredient", 5],
    ["feedstuff", 5],
    ["chemical composition", 8],
    ["composition", 4],
    ["amino acid", 8],
    ["amino acids", 8],
    ["lysine", 6],
    ["methionine", 6],
    ["threonine", 6],
    ["tryptophan", 6],
    ["arginine", 6],
    ["isoleucine", 4],
    ["valine", 4],
    ["leucine", 4],
    ["histidine", 3],
    ["phenylalanine", 3],
    ["tyrosine", 3],
    ["crude protein", 6],
    ["ether extract", 4],
    ["neutral detergent fiber", 6],
    ["ndf", 3],
    ["adf", 3],
    ["starch", 3],
    ["ash", 3],
    ["metabolizable energy", 4],
    ["kcal", 2],
    ["calcium", 3],
    ["phosphorus", 3],
    ["sodium", 2],
    ["potassium", 2],
    ["chloride", 2],
    ["zinc", 2],
    ["manganese", 2],
    ["copper", 2],
    ["iron", 2],
    ["selenium", 2],
    ["iodine", 2],
  ];

  let score = 0;
  for (const [k, w] of hits) if (t.includes(k)) score += w;

  // Bonus if looks table-ish: many numbers
  const numCount = (t.match(/\b\d+(\.\d+)?\b/g) || []).length;
  if (numCount > 50) score += 10;
  if (numCount > 120) score += 15;

  // Penalty if clearly TOC-ish
  if (t.includes("equation") || t.includes("methodology") || t.includes("curves")) score -= 10;

  return score;
}

function head(lines, n=25) {
  return (lines || []).slice(0, n).join("\n");
}

function main() {
  const dumpPath = process.argv[2] || path.resolve("tools", "br_extracted_dump.json");
  const dump = readJson(dumpPath);

  const rows = [];
  for (const p of (dump.pages || [])) {
    const s = scorePage(p.lines_sample || []);
    if (s <= 0) continue;
    rows.push({ page: p.page, score: s, head: head(p.lines_sample, 30) });
  }

  rows.sort((a,b) => b.score - a.score);

  console.log("Dump pages:", (dump.pages || []).length);
  console.log("Top candidates (first 25):");
  for (const r of rows.slice(0, 25)) {
    console.log("\n=== page", r.page, "score", r.score, "===\n" + r.head);
  }
}

main();
