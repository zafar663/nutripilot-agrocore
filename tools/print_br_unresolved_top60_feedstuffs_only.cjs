const fs = require("fs");

const p = "./tools/br_unresolved_rows.sample.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const rows = Array.isArray(j) ? j : (j.rows || j.sample || j.items || []);

console.log("rows=", rows.length);

function stripDiacritics(s){
  return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function norm(s){
  s = stripDiacritics(String(s||"").trim().toLowerCase());
  s = s.replace(/[(){}\[\],;:\/\\|\-_+=]+/g, " ");
  s = s.replace(/[^a-z0-9% ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Anything matching these patterns is a nutrient/attribute heading, not a feedstuff.
function isAttributeHeading(label){
  const s = norm(label);
  if (!s) return true;

  // If it contains a percent sign label (common nutrient rows)
  if (s.includes("%")) return true;

  // Minerals and vitamins headings
  const minerals = ["sodium","potassium","chloride","magnesium","calcium","phosphorus","iron","zinc","copper","manganese","selenium","iodine"];
  if (minerals.some(m => s === m || s.startsWith(m+" "))) return true;

  // Amino acid / nutrient list headings
  const aaWords = ["lysine","methionine","threonine","tryptophan","arginine","valine","isoleucine","leucine","histidine","phenylalanine","tyrosine","phe","tyr","gly","ser","cysteine","met","cys"];
  if (aaWords.some(w => s.includes(w))) {
    // if it's not clearly a feedstuff but a composition row, skip
    // "corn high lysine ..." should survive because it starts with corn
    if (!s.startsWith("corn ") && !s.startsWith("milho ") && !s.startsWith("soya ") && !s.startsWith("soy ") && !s.startsWith("wheat ") && !s.startsWith("rice ")) {
      return true;
    }
  }

  // Energy headings
  const energy = ["metabolizable energy","std metab energy","standard metabolizable energy","poultry digestible energy","digestible energy","gross energy"];
  if (energy.some(e => s.includes(e))) return true;

  // Generic nutrient headings
  const nutrient = ["dry matter","crude protein","crude fiber","ash","ether extract","n free extract","nfe","starch","sugars","ndf","adf","lignin","phytate p"];
  if (nutrient.some(n => s.includes(n))) return true;

  // Digestibility coefficient headings
  if (s.includes("coef") || s.includes("dig") || s.includes("digestibility") || s.includes("undig")) return true;

  return false;
}

const freq = new Map();
let kept = 0, dropped = 0;

for (const r of rows) {
  const lab = r.label_raw || r.label || r.name || "";
  if (isAttributeHeading(lab)) { dropped++; continue; }
  const s = String(lab).trim();
  if(!s) continue;
  kept++;
  freq.set(s, (freq.get(s)||0) + 1);
}

console.log("kept=", kept, "dropped_attribute_headings=", dropped);

const top = [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,60);
console.log("\nTop TRUE feedstuff-like unresolved labels (60):");
for (const [k,v] of top) console.log(String(v).padStart(4," ") + "  " + k);
