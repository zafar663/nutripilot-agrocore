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

function looksLikeIngredientName(labelNorm) {
  const s = labelNorm;
  if (!s) return false;
  if (s.includes(",")) return true;

  const ingWords = [
    "meal","oil","flour","bran","grain","gluten","ddgs","plasma","blood","bone","meat",
    "pulp","hull","cake","molasses","whey","cassava","corn","soy","wheat","rice",
    "sorghum","barley","oat","fish","shrimp","poultry","feather","limestone","phosphate"
  ];
  if (ingWords.some(w => s.includes(w))) return true;

  return false;
}

function looksLikeNutrientLabel(labelNorm) {
  const s = labelNorm;
  if (!s) return false;

  if (s.includes("%") || s.includes("mg/kg")) return true;

  const nutWords = [
    "energy","gross energy","digestible energy","metabolizable energy","net energy",
    "dry matter","moisture","organic matter","ash","crude protein","ether extract",
    "crude fiber","nfe","starch","ndf","adf","lignin",
    "calcium","phosphorus","available","digestible","phytate",
    "sodium","potassium","chlorine","chloride","sulfur","magnesium",
    "linoleic","linolenic","oleic",
    "lysine","methionine","cysteine","threonine","tryptophan","arginine",
    "valine","leucine","isoleucine","histidine","phenylalanine","tyrosine",
    "glycine","serine","alanine","proline","asparagine","aspartic acid","glutamine","glutamic acid",
    "phe + tyr","met + cys","gly + ser",
    "iron","manganese","zinc","copper","selenium","iodine"
  ];
  if (nutWords.some(w => s.includes(w))) return true;

  return false;
}

function splitDashDashDash(labelRaw) {
  const parts = String(labelRaw).split(/\s*-\s*-\s*-\s*/g).map(x => x.trim()).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts[1]];
  return null;
}

// ✅ Force-map nutrient key by keywords even if label_map doesn't contain it.
function forceKey(labelNorm) {
  const s = labelNorm;

  // Electrolytes / macros
  if (/\bpotassium\b|\bk\b/.test(s)) return "k";
  if (/\bsodium\b|\bna\b/.test(s)) return "na";
  if (/\bchlorine\b|\bchloride\b|\bcl\b/.test(s)) return "cl";
  if (/\bcalcium\b|\bca\b/.test(s)) return "ca";
  if (/\bavailable\b.*\bphosph/.test(s) || /\bpav\b/.test(s)) return "avp";
  if (/\bdigestible\b.*\bphosph/.test(s) || /\bdig\. p\b/.test(s)) return "dig_p";
  if (/\btotal phosphorus\b|\btotal p\b/.test(s)) return "p_total";
  if (/\bphytate p\b/.test(s)) return "p_phytate";

  // Trace minerals
  if (/\biron\b|\bfe\b/.test(s)) return "fe_mg_kg";
  if (/\bmanganese\b|\bmn\b/.test(s)) return "mn_mg_kg";
  if (/\bzinc\b|\bzn\b/.test(s)) return "zn_mg_kg";
  if (/\bcopper\b|\bcu\b/.test(s)) return "cu_mg_kg";
  if (/\bselenium\b|\bse\b/.test(s)) return "se_mg_kg";
  if (/\biodine\b|\bi\b/.test(s)) return "i_mg_kg";

  // Energy
  if (/\bgross energy\b/.test(s)) return "ge";
  if (/\bmetabolizable energy\b/.test(s)) return "me";
  if (/\bnet energy\b/.test(s)) return "ne";
  if (/\bdigestible energy\b/.test(s)) return "de";
  if (/\bstd\. metab\. energy\b/.test(s)) return "amen";

  // Proximate
  if (/\bdry matter\b/.test(s)) return "dm";
  if (/\bcrude protein\b|\bcp\b/.test(s)) return "cp";
  if (/\bether extract\b|\bee\b/.test(s)) return "ee";
  if (/\bcrude fiber\b|\bcf\b/.test(s)) return "cf";
  if (/\bstarch\b/.test(s)) return "starch";
  if (/\bash\b/.test(s)) return "ash";

  // Fatty acids
  if (/\blinoleic\b/.test(s)) return "linoleic";
  if (/\blinolenic\b/.test(s)) return "linolenic";
  if (/\boleic\b/.test(s)) return "oleic";

  // Total AA (examples)
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

  return null;
}

function main() {
  const dumpPath = process.argv[2] || path.resolve("tools", "br_extracted_dump.json");
  const mapPath  = process.argv[3] || path.resolve("tools", "br_label_map.v1.json");
  const outPath  = process.argv[4] || path.resolve("tools", "br_tables_parsed.v4.json");

  const dump = readJson(dumpPath);
  const mapJ = readJson(mapPath);
  const mapped = mapJ.mapped || {};

  const tables = [];
  let current = null;

  for (const p of (dump.pages || [])) {
    const lines = p.lines_sample || [];
    for (const raw of lines) {
      const line = String(raw).trim();
      if (!line) continue;

      const nums = parseNumbers(line);

      const lnorm = norm(line);
      if (lnorm.startsWith("table ")) {
        if (current && (current.ingredient_rows.length || current.nutrient_rows.length)) tables.push(current);
        current = { page: p.page, title: line, ingredient_rows: [], nutrient_rows: [] };
        continue;
      }

      if (nums.length < 2) continue;

      const beforeNum = line.match(/^(.+?)(?=\s+-?\d)/);
      const labelRaw = beforeNum ? beforeNum[1] : null;
      if (!labelRaw) continue;

      if (!current) current = { page: p.page, title: `page_${p.page}`, ingredient_rows: [], nutrient_rows: [] };

      // ✅ v4: ALWAYS split "A - - - B" when present and assign first numeric to A and second to B
      const split2 = splitDashDashDash(labelRaw);
      if (split2 && nums.length >= 2) {
        const aRaw = split2[0];
        const bRaw = split2[1];
        const aNorm = norm(aRaw);
        const bNorm = norm(bRaw);

        const aKey = mapped[aNorm] || forceKey(aNorm);
        const bKey = mapped[bNorm] || forceKey(bNorm);

        // if either side looks nutrient-ish, treat as nutrient split
        const aNut = looksLikeNutrientLabel(aNorm) || !!aKey;
        const bNut = looksLikeNutrientLabel(bNorm) || !!bKey;

        if (aNut || bNut) {
          current.nutrient_rows.push({
            label_raw: aRaw,
            label_norm: aNorm,
            key: aKey,
            values: [nums[0]],
            _split_from: labelRaw.trim()
          });
          current.nutrient_rows.push({
            label_raw: bRaw,
            label_norm: bNorm,
            key: bKey,
            values: [nums[1]],
            _split_from: labelRaw.trim()
          });
          continue;
        }
      }

      const labelNorm = norm(labelRaw);
      const key = mapped[labelNorm] || forceKey(labelNorm);

      const isNutrient = (!!key && !looksLikeIngredientName(labelNorm)) || looksLikeNutrientLabel(labelNorm);
      const isIngredient = looksLikeIngredientName(labelNorm) && !looksLikeNutrientLabel(labelNorm);

      if (isIngredient && !isNutrient) {
        current.ingredient_rows.push({
          name_raw: labelRaw.trim(),
          name_norm: labelNorm,
          values: nums
        });
      } else if (isNutrient) {
        current.nutrient_rows.push({
          label_raw: labelRaw.trim(),
          label_norm: labelNorm,
          key,
          values: nums
        });
      } else {
        current.ingredient_rows.push({
          name_raw: labelRaw.trim(),
          name_norm: labelNorm,
          values: nums,
          _note: "ambiguous_row_defaulted_to_ingredient"
        });
      }
    }
  }

  if (current && (current.ingredient_rows.length || current.nutrient_rows.length)) tables.push(current);

  const out = {
    _meta: {
      dump: dumpPath,
      map: mapPath,
      generated_at: new Date().toISOString(),
      note: "v4: always splits A - - - B nutrient rows; force-maps minerals/AAs by keywords when label_map missing."
    },
    tables_count: tables.length,
    tables
  };

  writeJson(outPath, out);

  console.log("✅ Wrote:", outPath);
  console.log("tables:", tables.length);
}

main();
