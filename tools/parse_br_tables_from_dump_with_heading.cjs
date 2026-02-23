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

// Force-map (same as v4)
function forceKey(labelNorm) {
  const s = labelNorm;

  if (/\bpotassium\b|\bk\b/.test(s)) return "k";
  if (/\bsodium\b|\bna\b/.test(s)) return "na";
  if (/\bchlorine\b|\bchloride\b|\bcl\b/.test(s)) return "cl";
  if (/\bcalcium\b|\bca\b/.test(s)) return "ca";
  if (/\bavailable\b.*\bphosph/.test(s) || /\bpav\b/.test(s)) return "avp";
  if (/\bdigestible\b.*\bphosph/.test(s) || /\bdig\. p\b/.test(s)) return "dig_p";
  if (/\btotal phosphorus\b|\btotal p\b/.test(s)) return "p_total";
  if (/\bphytate p\b/.test(s)) return "p_phytate";

  if (/\biron\b|\bfe\b/.test(s)) return "fe_mg_kg";
  if (/\bmanganese\b|\bmn\b/.test(s)) return "mn_mg_kg";
  if (/\bzinc\b|\bzn\b/.test(s)) return "zn_mg_kg";
  if (/\bcopper\b|\bcu\b/.test(s)) return "cu_mg_kg";
  if (/\bselenium\b|\bse\b/.test(s)) return "se_mg_kg";
  if (/\biodine\b|\bi\b/.test(s)) return "i_mg_kg";

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
  if (/\bphenylalanine\b/.test(s)) return "total_phe";
  if (/\btyrosine\b/.test(s)) return "total_tyr";
  if (/\balanine\b/.test(s)) return "total_ala";
  if (/\bglycine\b/.test(s)) return "total_gly";
  if (/\bserine\b/.test(s)) return "total_ser";
  if (/\bproline\b/.test(s)) return "total_pro";
  if (/\baspartic acid\b/.test(s)) return "total_asp";
  if (/\bglutamic acid\b/.test(s)) return "total_glu";
  if (/\basparagine\b/.test(s)) return "total_asn";
  if (/\bglutamine\b/.test(s)) return "total_gln";

  return null;
}

function isHeadingLine(line) {
  // "heading" heuristic: no numbers, not empty, not Table, not generic boilerplate
  const s = String(line || "").trim();
  if (!s) return false;
  if (/^table\s+/i.test(s)) return false;
  if (parseNumbers(s).length > 0) return false;
  if (s.length < 3) return false;

  const n = norm(s);
  const banned = [
    "brazilian tables for poultry and swine",
    "values of poultry and swine feedstuffs",
    "chemical composition",
    "digestibility",
    "energy",
    "mean n sd",
    "practical",
    "maximum"
  ];
  if (banned.some(b => n.includes(b))) return false;

  return true;
}

function main() {
  const dumpPath = process.argv[2] || path.resolve("tools", "br_extracted_dump.json");
  const mapPath  = process.argv[3] || path.resolve("tools", "br_label_map.v1.json");
  const outPath  = process.argv[4] || path.resolve("tools", "br_tables_parsed.v5.json");

  const dump = readJson(dumpPath);
  const mapJ = readJson(mapPath);
  const mapped = mapJ.mapped || {};

  const tables = [];
  let current = null;
  let lastHeadingRaw = null;

  for (const p of (dump.pages || [])) {
    const lines = p.lines_sample || [];

    for (const raw of lines) {
      const line = String(raw).trim();
      if (!line) continue;

      // capture heading candidate
      if (isHeadingLine(line)) {
        lastHeadingRaw = line;
      }

      const nums = parseNumbers(line);
      const lnorm = norm(line);

      if (lnorm.startsWith("table ")) {
        if (current && (current.nutrient_rows.length || current.ingredient_rows.length)) tables.push(current);
        current = {
          page: p.page,
          title: line,
          heading_raw: lastHeadingRaw,
          heading_norm: norm(lastHeadingRaw || ""),
          ingredient_rows: [],
          nutrient_rows: []
        };
        continue;
      }

      if (nums.length < 2) continue;

      const beforeNum = line.match(/^(.+?)(?=\s+-?\d)/);
      const labelRaw = beforeNum ? beforeNum[1] : null;
      if (!labelRaw) continue;

      if (!current) {
        current = {
          page: p.page,
          title: `page_${p.page}`,
          heading_raw: lastHeadingRaw,
          heading_norm: norm(lastHeadingRaw || ""),
          ingredient_rows: [],
          nutrient_rows: []
        };
      }

      // split A - - - B
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

      // treat as nutrient row by default in these per-table layouts
      current.nutrient_rows.push({
        label_raw: labelRaw.trim(),
        label_norm: labelNorm,
        key,
        values: nums
      });
    }
  }

  if (current && (current.nutrient_rows.length || current.ingredient_rows.length)) tables.push(current);

  writeJson(outPath, {
    _meta: {
      dump: dumpPath,
      map: mapPath,
      generated_at: new Date().toISOString(),
      note: "v5: captures heading before each table to identify ingredient; keeps nutrient_rows and split A - - - B."
    },
    tables_count: tables.length,
    tables
  });

  console.log("✅ Wrote:", outPath);
  console.log("tables:", tables.length);
  const t = tables[10];
  if (t) {
    console.log("sample table[10]:", t.title);
    console.log("heading_raw:", t.heading_raw);
    console.log("heading_norm:", t.heading_norm);
    console.log("nutrient_rows:", t.nutrient_rows.length);
    console.log("first 10 nutrient rows:");
    for (const r of t.nutrient_rows.slice(0,10)) console.log("-", r.key, "|", r.label_raw, "|", r.values);
  }
}

main();
