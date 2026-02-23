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

function main() {
  const labelsPath = process.argv[2] || path.resolve("tools", "br_detected_labels.json");
  const outPath = process.argv[3] || path.resolve("tools", "br_label_map.v1.json");

  if (!fs.existsSync(labelsPath)) {
    console.error("Missing:", labelsPath);
    process.exit(1);
  }

  const L = readJson(labelsPath);
  const top = (L.top_labels || []).map(x => x.label);

  const rules = [
    // Energy
    { re: /gross energy/i, key: "ge" },
    { re: /hens digestible energy/i, key: "de_hens" },
    { re: /poultry digestible energy/i, key: "de_poultry" },
    { re: /\bdigestible energy\b/i, key: "de" },
    { re: /\bmetabolizable energy\b/i, key: "me" },
    { re: /\bstd\. metab\. energy\b/i, key: "amen" },
    { re: /\bnet energy\b/i, key: "ne" },

    // Proximate
    { re: /\bdry matter\b/i, key: "dm" },
    { re: /\bmoisture\b/i, key: "moisture" },
    { re: /\borganic matter\b/i, key: "om" },
    { re: /\bash\b/i, key: "ash" },
    { re: /\bcrude protein\b|\btotal % cp\b|\bcrude protein cp\b/i, key: "cp" },
    { re: /\bether extract\b|\bee\b/i, key: "ee" },
    { re: /\bcrude fiber\b|\bcf\b/i, key: "cf" },
    { re: /\bn-free extract\b|\bnfe\b/i, key: "nfe" },
    { re: /\bstarch\b/i, key: "starch" },

    // Fiber fractions
    { re: /\bndf\b|\bneutral detergent fiber\b/i, key: "ndf" },
    { re: /\badf\b|\bacid detergent fiber\b/i, key: "adf" },
    { re: /\blignin\b/i, key: "lignin" },

    // Minerals / electrolytes
    { re: /\btotal calcium\b|\bcalcium\b/i, key: "ca" },
    { re: /\btotal phosphorus\b|\btotal p\b/i, key: "p_total" },
    { re: /\bavailable p\b|\bpav\b|\bavailable phosphorus\b/i, key: "avp" },
    { re: /\bnon phytate p\b|\bnpp\b/i, key: "npp" },
    { re: /\bphytate p\b/i, key: "p_phytate" },
    { re: /\bdigestible phosphorus\b|\bstd\. dig\. p\b|\bdig\. p\b/i, key: "dig_p" },
    { re: /\bmagnesium\b|\bmagnesium mg\b/i, key: "mg" },
    { re: /\bsulfur\b/i, key: "s" },
    { re: /\bsodium\b|\bna\b/i, key: "na" },
    { re: /\bpotassium\b|\bk\b/i, key: "k" },
    { re: /\bchlorine\b|\bchloride\b|\bcl\b/i, key: "cl" },

    // Fatty acids
    { re: /\blinoleic acid\b/i, key: "linoleic" },
    { re: /\blinolenic\b/i, key: "linolenic" },
    { re: /\boleic\b/i, key: "oleic" },

    // Trace minerals (mg/kg)
    { re: /\biron\b|\bfe\b/i, key: "fe_mg_kg" },
    { re: /\bmanganese\b|\bmn\b/i, key: "mn_mg_kg" },
    { re: /\bzinc\b|\bzn\b/i, key: "zn_mg_kg" },
    { re: /\bcopper\b|\bcu\b/i, key: "cu_mg_kg" },
    { re: /\biodine\b/i, key: "i_mg_kg" },
    { re: /\bselenium\b|\bse\b/i, key: "se_mg_kg" },

    // Amino acids TOTAL
    { re: /\bmethionine \+ cysteine\b|\bmethionine \+ cysteine %\b|\bmet \+ cys\b|\bmet\. \+ cys\b/i, key: "total_metcys" },
    { re: /\bphenylalanine \+ tyrosine\b|\bphe \+ tyr\b/i, key: "total_phe_tyr" },
    { re: /\bgly \+ ser\b/i, key: "total_gly_ser" },

    { re: /\blysine\b/i, key: "total_lys" },
    { re: /\bmethionine\b/i, key: "total_met" },
    { re: /\bcysteine\b/i, key: "total_cys" },
    { re: /\bthreonine\b/i, key: "total_thr" },
    { re: /\btryptophan\b/i, key: "total_trp" },
    { re: /\barginine\b/i, key: "total_arg" },
    { re: /\bisoleucine\b/i, key: "total_ile" },
    { re: /\bleucine\b/i, key: "total_leu" },
    { re: /\bvaline\b/i, key: "total_val" },
    { re: /\bhistidine\b/i, key: "total_his" },
    { re: /\bphenylalanine\b/i, key: "total_phe" },
    { re: /\btyrosine\b/i, key: "total_tyr" },
    { re: /\balanine\b/i, key: "total_ala" },
    { re: /\bglycine\b/i, key: "total_gly" },
    { re: /\bserine\b/i, key: "total_ser" },
    { re: /\bglutamic acid\b/i, key: "total_glu" },
    { re: /\baspartic acid\b/i, key: "total_asp" },
    { re: /\basparagine\b/i, key: "total_asn" },
    { re: /\bglutamine\b/i, key: "total_gln" },
    { re: /\bproline\b/i, key: "total_pro" }
  ];

  const mapped = {};
  const unmapped = [];

  for (const label of top) {
    let key = null;
    for (const r of rules) {
      if (r.re.test(label)) { key = r.key; break; }
    }
    if (key) mapped[label] = key;
    else unmapped.push(label);
  }

  const out = {
    _LOCK: {
      status: "LOCKED",
      schema: "nutripilot.br_label_map.v1",
      note: "Auto-generated from detected BR labels. You can add manual overrides later without breaking parser.",
      generated_at: new Date().toISOString()
    },
    mapped,
    unmapped_top200: unmapped.slice(0, 200)
  };

  writeJson(outPath, out);

  console.log("✅ Wrote:", outPath);
  console.log("mapped:", Object.keys(mapped).length);
  console.log("unmapped:", unmapped.length);
}

main();
