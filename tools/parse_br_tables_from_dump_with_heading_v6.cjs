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

// same forceKey as v4/v5 (keep it)
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

function isGarbageHeading(n) {
  if (!n) return true;
  const banned = [
    "feedstuff page",
    "feedstuff",
    "page",
    "brazilian tables for poultry and swine",
    "values of poultry and swine feedstuffs",
    "chemical composition",
    "digestibility",
    "energy",
    "mean n sd",
    "practical",
    "maximum"
  ];
  return banned.some(b => n === b || n.includes(b));
}

function loadKnownIngredientNorms(brSkeletonPath) {
  const sk = readJson(brSkeletonPath);
  const ing = sk.ingredients || {};
  const set = new Set();

  for (const [id, row] of Object.entries(ing)) {
    set.add(norm(id.replace(/_/g, " ")));
    if (row && row.display_name) set.add(norm(row.display_name));
  }
  return set;
}

function pickHeadingFromBuffer(recentLines, knownSet) {
  // scan backwards for first line matching known ingredient norms
  for (let i = recentLines.length - 1; i >= 0; i--) {
    const raw = recentLines[i];
    const n = norm(raw);
    if (!n) continue;
    if (isGarbageHeading(n)) continue;
    if (parseNumbers(raw).length > 0) continue; // headings have no numbers
    if (knownSet.has(n)) return { raw, norm: n, method: "known_match" };
  }

  // fallback: last non-garbage no-number line
  for (let i = recentLines.length - 1; i >= 0; i--) {
    const raw = recentLines[i];
    const n = norm(raw);
    if (!n) continue;
    if (isGarbageHeading(n)) continue;
    if (parseNumbers(raw).length > 0) continue;
    if (n.length < 3) continue;
    return { raw, norm: n, method: "fallback_last_heading" };
  }

  return { raw: null, norm: "", method: "missing" };
}

function main() {
  const dumpPath = process.argv[2] || path.resolve("tools", "br_extracted_dump.json");
  const mapPath  = process.argv[3] || path.resolve("tools", "br_label_map.v1.json");
  const outPath  = process.argv[4] || path.resolve("tools", "br_tables_parsed.v6.json");

  const brSkeletonPath = path.resolve("core", "db", "ingredients", "ingredients.br.v1.json");
  const knownSet = loadKnownIngredientNorms(brSkeletonPath);

  const dump = readJson(dumpPath);
  const mapJ = readJson(mapPath);
  const mapped = mapJ.mapped || {};

  const tables = [];
  let current = null;
  let recentLines = []; // rolling buffer of last lines (per page)

  for (const p of (dump.pages || [])) {
    const lines = p.lines_sample || [];
    recentLines = [];

    for (const rawLine of lines) {
      const line = String(rawLine).trim();
      if (!line) continue;

      // maintain rolling buffer
      recentLines.push(line);
      if (recentLines.length > 80) recentLines.shift();

      const lnorm = norm(line);
      if (lnorm.startsWith("table ")) {
        if (current && current.nutrient_rows.length) tables.push(current);

        const picked = pickHeadingFromBuffer(recentLines, knownSet);

        current = {
          page: p.page,
          title: line,
          heading_raw: picked.raw,
          heading_norm: picked.norm,
          heading_method: picked.method,
          nutrient_rows: []
        };
        continue;
      }

      if (!current) continue; // only parse nutrient rows after a table starts

      const nums = parseNumbers(line);
      if (nums.length < 1) continue;

      const beforeNum = line.match(/^(.+?)(?=\s+-?\d)/);
      const labelRaw = beforeNum ? beforeNum[1] : null;
      if (!labelRaw) continue;

      // A - - - B split
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
      generated_at: new Date().toISOString(),
      note: "v6: table heading picked by matching known BR ingredient display_name/IDs; avoids Feedstuff Page."
    },
    tables_count: tables.length,
    tables
  });

  console.log("✅ Wrote:", outPath);
  console.log("tables:", tables.length);

  // quick sample
  const t = tables[10];
  if (t) {
    console.log("sample table[10]:", t.title);
    console.log("heading_raw:", t.heading_raw);
    console.log("heading_method:", t.heading_method);
    console.log("nutrient_rows:", t.nutrient_rows.length);
    console.log("first 12 nutrient rows:");
    for (const r of t.nutrient_rows.slice(0,12)) console.log("-", r.key, "|", r.label_raw, "|", r.values);
  }
}

main();
