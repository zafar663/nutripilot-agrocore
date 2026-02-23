"use strict";

const fs = require("fs");
const path = require("path");

function readJson(p) {
  let raw = fs.readFileSync(p, "utf8");
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
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
    .replace(/\s+/g, " ")
    .replace(/[^\w\s\+\-\/\.%,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function parseNumbers(line) {
  const m = String(line).match(/-?\d+(\.\d+)?/g);
  return (m || []).map(x => Number(x)).filter(x => Number.isFinite(x));
}
function splitDashDashDash(labelRaw) {
  const parts = String(labelRaw).split(/\s*-\s*-\s*-\s*/g).map(x => x.trim()).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts[1]];
  return null;
}

// keep your forceKey (same as before but shortened here; reuse your current file if you want)
function forceKey(labelNorm) {
  const s = labelNorm;

  if (/\bpotassium\b|\bk\b/.test(s)) return "k";
  if (/\bsodium\b|\bna\b/.test(s)) return "na";
  if (/\bchlorine\b|\bchloride\b|\bcl\b/.test(s)) return "cl";

  if (/\biron\b|\bfe\b/.test(s)) return "fe_mg_kg";
  if (/\bmanganese\b|\bmn\b/.test(s)) return "mn_mg_kg";
  if (/\bzinc\b|\bzn\b/.test(s)) return "zn_mg_kg";
  if (/\bcopper\b|\bcu\b/.test(s)) return "cu_mg_kg";

  if (/\bgross energy\b/.test(s)) return "ge";
  if (/\bmetabolizable energy\b/.test(s)) return "me";
  if (/\bnet energy\b/.test(s)) return "ne";
  if (/\bdigestible energy\b/.test(s)) return "de";
  if (/\bstd\. metab\. energy\b/.test(s)) return "amen";

  if (/\bdry matter\b/.test(s)) return "dm";
  if (/\bcrude protein\b|\bcp\b/.test(s)) return "cp";
  if (/\bether extract\b|\bee\b/.test(s)) return "ee";
  if (/\bcrude fiber\b|\bcf\b/.test(s)) return "cf";
  if (/\bstarch\b/.test(s)) return "starch";
  if (/\bash\b/.test(s)) return "ash";
  if (/\bndf\b/.test(s)) return "ndf";
  if (/\badf\b/.test(s)) return "adf";
  if (/\blignin\b/.test(s)) return "lignin";

  if (/\blinoleic\b/.test(s)) return "linoleic";
  if (/\blinolenic\b/.test(s)) return "linolenic";
  if (/\boleic\b/.test(s)) return "oleic";

  if (/\bmethionine \+ cysteine\b|\bmet \+ cys\b/.test(s)) return "total_metcys";
  if (/\bphenylalanine \+ tyrosine\b|\bphe \+ tyr\b/.test(s)) return "total_phe_tyr";
  if (/\bgly \+ ser\b/.test(s)) return "total_gly_ser";
  if (/\blysine\b/.test(s)) return "total_lys";
  if (/\bmethionine\b/.test(s)) return "total_met";
  if (/\bcysteine\b/.test(s)) return "total_cys";
  if (/\bthreonine\b/.test(s)) return "total_thr";
  if (/\btryptophan\b/.test(s)) return "total_trp";
  if (/\barginine\b/.test(s)) return "total_arg";
  if (/\bisoleucine\b/.test(s)) return "total_ile";
  if (/\bleucine\b/.test(s)) return "total_leu";
  if (/\bvaline\b/.test(s)) return "total_val";
  if (/\bhistidine\b/.test(s)) return "total_his";

  return null;
}

function loadKnownList(brSkeletonPath) {
  const sk = readJson(brSkeletonPath);
  const ing = sk.ingredients || {};
  const list = [];
  for (const [id, row] of Object.entries(ing)) {
    const dn = row && row.display_name ? String(row.display_name) : null;
    if (dn) list.push({ raw: dn, n: norm(dn) });
  }
  list.sort((a, b) => b.n.length - a.n.length);
  return list;
}

function getFullTextFromDump(dump) {
  // try common keys
  let t = dump.full_text || dump.text || dump.fullText || dump.fulltext || "";
  if (t && typeof t === "string" && t.length > 1000) return t;

  // fallback: join all lines_sample (works even if extractor didn't store full_text)
  const parts = [];
  for (const p of (dump.pages || [])) {
    for (const ln of (p.lines_sample || [])) parts.push(String(ln));
  }
  return parts.join("\n");
}

function extractTableNo(titleLine) {
  // titleLine like "Table 1.01 - Chemical Composition..."
  const m = String(titleLine).match(/Table\s+(\d+\.\d+)/i);
  return m ? m[1] : null;
}

function findHeadingFromFullText(fullText, tableTitleRaw, knownList) {
  const tableNo = extractTableNo(tableTitleRaw);
  if (!tableNo) return { raw: null, norm: "", method: "no_table_no" };

  // match only "Table 1.01" with flexible spaces
  const re = new RegExp(`Table\\s+${tableNo.replace(/\./g, "\\.")}`, "i");
  const idx = fullText.search(re);
  if (idx < 0) return { raw: null, norm: "", method: "table_no_not_found" };

  const back = fullText.slice(Math.max(0, idx - 8000), idx);

  let best = null;
  let bestPos = -1;
  for (const k of knownList) {
    const p = back.lastIndexOf(k.raw);
    if (p > bestPos) {
      bestPos = p;
      best = k;
    }
  }

  if (best && bestPos >= 0) return { raw: best.raw, norm: best.n, method: "fulltext_known_match" };

  // fallback: last non-empty, no-number line
  const lines = back.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (parseNumbers(raw).length) continue;
    const n = norm(raw);
    if (n.length >= 3) return { raw, norm: n, method: "fulltext_fallback_lastline" };
  }

  return { raw: null, norm: "", method: "missing" };
}

function main() {
  const dumpPath = process.argv[2] || path.resolve("tools", "br_extracted_dump.json");
  const mapPath  = process.argv[3] || path.resolve("tools", "br_label_map.v1.json");
  const outPath  = process.argv[4] || path.resolve("tools", "br_tables_parsed.v7b.json");

  const brSkeletonPath = path.resolve("core", "db", "ingredients", "ingredients.br.v1.json");
  const knownList = loadKnownList(brSkeletonPath);

  const dump = readJson(dumpPath);
  const fullText = getFullTextFromDump(dump);

  const mapJ = readJson(mapPath);
  const mapped = mapJ.mapped || {};

  const tables = [];
  let current = null;

  for (const p of (dump.pages || [])) {
    const lines = p.lines_sample || [];

    for (const rawLine of lines) {
      const line = String(rawLine).trim();
      if (!line) continue;

      const lnorm = norm(line);
      if (lnorm.startsWith("table ")) {
        if (current && current.nutrient_rows.length) tables.push(current);

        const picked = findHeadingFromFullText(fullText, line, knownList);

        current = {
          page: p.page,
          title: line,
          table_no: extractTableNo(line),
          heading_raw: picked.raw,
          heading_norm: picked.norm,
          heading_method: picked.method,
          nutrient_rows: []
        };
        continue;
      }

      if (!current) continue;

      const nums = parseNumbers(line);
      if (nums.length < 1) continue;

      const beforeNum = line.match(/^(.+?)(?=\s+-?\d)/);
      const labelRaw = beforeNum ? beforeNum[1] : null;
      if (!labelRaw) continue;

      const split2 = splitDashDashDash(labelRaw);
      if (split2 && nums.length >= 2) {
        const aRaw = split2[0], bRaw = split2[1];
        const aNorm = norm(aRaw), bNorm = norm(bRaw);
        const aKey = mapped[aNorm] || forceKey(aNorm);
        const bKey = mapped[bNorm] || forceKey(bNorm);

        current.nutrient_rows.push({ label_raw: aRaw, label_norm: aNorm, key: aKey, values: [nums[0]], _split_from: labelRaw.trim() });
        current.nutrient_rows.push({ label_raw: bRaw, label_norm: bNorm, key: bKey, values: [nums[1]], _split_from: labelRaw.trim() });
        continue;
      }

      const labelNorm = norm(labelRaw);
      const key = mapped[labelNorm] || forceKey(labelNorm);

      current.nutrient_rows.push({
        label_raw: labelRaw.trim(),
        label_norm: labelNorm,
        key,
        values: nums
      });
    }
  }

  if (current && current.nutrient_rows.length) tables.push(current);

  writeJson(outPath, {
    _meta: {
      dump: dumpPath,
      map: mapPath,
      br_skeleton: brSkeletonPath,
      full_text_len: fullText.length,
      generated_at: new Date().toISOString(),
      note: "v7b: heading chosen by searching full text for Table <no> (regex), then scanning backwards for nearest known ingredient display_name."
    },
    tables_count: tables.length,
    tables
  });

  console.log("✅ Wrote:", outPath);
  console.log("tables:", tables.length);

  const t = tables[10];
  if (t) {
    console.log("sample table[10]:", t.title);
    console.log("table_no:", t.table_no);
    console.log("heading_raw:", t.heading_raw);
    console.log("heading_method:", t.heading_method);
    console.log("nutrient_rows:", t.nutrient_rows.length);
    console.log("first 12 nutrient rows:");
    for (const r of t.nutrient_rows.slice(0,12)) console.log("-", r.key, "|", r.label_raw, "|", r.values);
  }
}

main();
