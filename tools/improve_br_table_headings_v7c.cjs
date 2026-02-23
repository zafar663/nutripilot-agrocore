"use strict";

const fs = require("fs");
const path = require("path");

function readJson(p) {
  let raw = fs.readFileSync(p, "utf8");
  if (raw && raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[(),;]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s\+\-\/\.%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadCandidates() {
  const skPath = path.resolve("core", "db", "ingredients", "ingredients.br.v1.json");
  const sk = readJson(skPath);
  const ing = sk.ingredients || {};

  const aliasPath = path.resolve("core", "db", "aliases", "poultry", "br", "v1", "aliases.poultry.br.v1.json");
  const ali = readJson(aliasPath);
  const aliasesNode = ali.aliases || ali.db || ali.map || {};

  const candidates = new Map();

  for (const [id, row] of Object.entries(ing)) {
    const dn = row && row.display_name ? String(row.display_name) : null;
    if (!dn) continue;
    const n = norm(dn);
    if (n && !candidates.has(n)) candidates.set(n, { raw: dn, kind: "display_name" });
  }

  for (const k of Object.keys(aliasesNode)) {
    const n = norm(k);
    if (n && !candidates.has(n)) candidates.set(n, { raw: k, kind: "alias_key" });
  }

  const list = Array.from(candidates.entries())
    .map(([n, meta]) => ({ n, raw: meta.raw, kind: meta.kind }))
    .sort((a, b) => b.n.length - a.n.length);

  return { list, skPath, aliasPath };
}

function findTitleIndex(lines, title) {
  const t = norm(title);
  if (!t) return -1;

  for (let i = 0; i < lines.length; i++) {
    if (norm(lines[i]) === t) return i;
  }
  for (let i = 0; i < lines.length; i++) {
    const ln = norm(lines[i]);
    if (ln && (ln.includes(t) || t.includes(ln))) return i;
  }
  return -1;
}

function isJunkLine(raw) {
  const s = norm(raw);
  if (!s) return true;

  const junk = [
    "values of poultry",
    "values of poultry and swine",
    "brazilian tables",
    "main components",
    "mean n sd",
    "energy kcal kg",
    "minerals",
    "trace minerals",
    "macro minerals",
    "organic matter",
    "gross energy",
    "metabolizable energy",
    "dry matter",
    "crude protein",
    "starch",
    "crude fiber",
    "ndf",
    "adf",
    "ash"
  ];
  return junk.some(j => s.includes(j));
}

function bestMatchInLines(lines, candList, methodTag) {
  // prefer closest-to-top (for forward scan) or closest-to-bottom (for backward scan)
  // caller controls line order; we just pick first best match by:
  // exact first, then contains (longest candidate first due to candList sort)
  for (const rawLine of lines) {
    const raw = String(rawLine || "").trim();
    if (!raw) continue;
    if (isJunkLine(raw)) continue;

    const ln = norm(raw);
    if (!ln) continue;

    for (const c of candList) {
      if (ln === c.n) return { raw: c.raw, norm: c.n, method: methodTag + "_exact", buffer_raw: raw, kind: c.kind };
    }
    for (const c of candList) {
      if (c.n.length < 4) continue;
      if (ln.includes(c.n)) return { raw: c.raw, norm: c.n, method: methodTag + "_contains", buffer_raw: raw, kind: c.kind };
    }
  }
  return null;
}

function looksLikeGarbageHeading(headingRaw, headingMethod) {
  const hr = String(headingRaw || "").trim();
  const hm = String(headingMethod || "").trim();
  if (!hr) return true;

  const badMethods = new Set(["fulltext_fallback_lastline", "fulltext_fallback", "fallback_lastline", "fallback"]);
  if (badMethods.has(hm)) return true;
  if (hr.length > 80) return true;

  const h = norm(hr);
  const badWords = ["equation", "equations", "methodology", "determined by", "similar to those presented", "genetic potential"];
  if (badWords.some(w => h.includes(norm(w)))) return true;

  return false;
}

function main() {
  const dumpPath = process.argv[2] || path.resolve("tools", "br_extracted_dump.json");
  const inTablesPath = process.argv[3] || path.resolve("tools", "br_tables_parsed.v7b.json");
  const outPath = process.argv[4] || path.resolve("tools", "br_tables_parsed.v7f.json");

  const dump = readJson(dumpPath);
  const pages = dump.pages || [];

  const j = readJson(inTablesPath);
  const tables = j.tables || [];

  const { list: candList, skPath, aliasPath } = loadCandidates();

  const pageMap = new Map();
  for (const p of pages) pageMap.set(p.page, p.lines_sample || []);

  let upgraded = 0;
  let keptGood = 0;
  let wipedGarbage = 0;
  let missing = 0;

  const FORWARD = 60;
  const BACKWARD = 180;

  for (const t of tables) {
    const lines = pageMap.get(t.page) || [];
    const idx = findTitleIndex(lines, t.title);

    // Forward scan: lines AFTER title
    let forward = [];
    if (idx >= 0) forward = lines.slice(idx + 1, Math.min(lines.length, idx + 1 + FORWARD));

    // Backward scan: lines BEFORE title
    const end = (idx >= 0 ? idx : lines.length);
    const start = Math.max(0, end - BACKWARD);
    const backward = lines.slice(start, end);

    // Prefer forward match
    let m = bestMatchInLines(forward, candList, "page_forward");
    if (!m) {
      // backward: search from nearest lines first => reverse
      m = bestMatchInLines(backward.slice().reverse(), candList, "page_backward");
    }

    if (m) {
      t.heading_raw = m.raw;
      t.heading_norm = m.norm;
      t.heading_method = m.method;
      t.heading_debug = { buffer_raw: m.buffer_raw, kind: m.kind, title_idx: idx };
      upgraded++;
      continue;
    }

    // No match: wipe garbage, else keep
    if (looksLikeGarbageHeading(t.heading_raw, t.heading_method)) {
      const prev = { raw: t.heading_raw || null, method: t.heading_method || null };
      t.heading_raw = null;
      t.heading_norm = null;
      t.heading_method = "none";
      t.heading_debug = { reason: "no_match_wiped_bad", prev, title_idx: idx };
      wipedGarbage++;
      missing++;
    } else if (t.heading_raw) {
      keptGood++;
    } else {
      t.heading_raw = null;
      t.heading_norm = null;
      t.heading_method = "none";
      t.heading_debug = { reason: "no_match_no_heading", title_idx: idx };
      missing++;
    }
  }

  const out = {
    _meta: {
      dump: dumpPath,
      in_tables: inTablesPath,
      br_skeleton: skPath,
      br_aliases: aliasPath,
      generated_at: new Date().toISOString(),
      note: "v7f: heading repair prefers forward scan after table title; backward scan fallback; wipes fallback headings."
    },
    tables_count: tables.length,
    tables
  };

  writeJson(outPath, out);

  console.log("✅ Wrote:", outPath);
  console.log("tables:", tables.length);
  console.log("upgraded_headings:", upgraded);
  console.log("kept_good_headings:", keptGood);
  console.log("wiped_garbage_headings:", wipedGarbage);
  console.log("still_missing_heading:", missing);

  const counts = new Map();
  for (const t of tables) {
    const k = t.heading_method || "none";
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  console.log("heading_method counts:");
  for (const [k, n] of Array.from(counts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(n, k);
  }
}

main();
