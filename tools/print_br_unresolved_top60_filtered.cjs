const fs = require("fs");

const p = "./tools/br_unresolved_rows.sample.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const rows = Array.isArray(j) ? j : (j.rows || j.sample || j.items || []);

console.log("rows=", rows.length);

function stripDiacritics(s){
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function norm(s){
  s = String(s || "").trim().toLowerCase();
  s = stripDiacritics(s);
  s = s.replace(/[(){}\[\],;:\/\\|\-_+=]+/g, " ");
  s = s.replace(/[^a-z0-9% ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

const nutrientLike = new Set([
  "dry matter","crude protein","gross energy","metabolizable energy","ash","ether extract","ee",
  "starch","sugars","crude fiber","cf","ndf","adf","lignin",
  "calcium","ca","phosphorus","p","available phosphorus","avp","sodium","na","potassium","k","chloride","cl",
  "lysine","methionine","cystine","threonine","tryptophan","arginine",
  "total lys","total met","total thr","total trp","total arg","total cys",
  "crude protein cp"
]);

function isNutrientRow(r){
  const lab = norm(r.label_raw);
  if(!lab) return true;
  if(nutrientLike.has(lab)) return true;

  // if label looks like a heading and key is a known nutrient key
  const k = norm(r.key);
  const knownKeys = new Set(["dm","cp","ge","me","ee","ash","starch","na","k","cl","ca","p_total","avp","total_lys","total_met","total_thr","total_trp","total_arg","total_cys"]);
  if(knownKeys.has(k) && (lab.includes("energy") || lab.includes("protein") || lab.includes("matter") || lab.includes("lys") || lab.includes("met") || lab.includes("thr") || lab.includes("trp") || lab.includes("arg") || lab.includes("cys"))) {
    return true;
  }
  return false;
}

const freq = new Map();
let kept = 0, dropped = 0;

for(const r of rows){
  if(isNutrientRow(r)) { dropped++; continue; }
  const s = String(r.label_raw || "").trim();
  if(!s) continue;
  kept++;
  freq.set(s, (freq.get(s)||0) + 1);
}

console.log("kept=", kept, "dropped_nutrientlike=", dropped);

const top = [...freq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,60);
console.log("\nTop ingredient-like unresolved labels (60):");
for(const [k,v] of top){
  console.log(String(v).padStart(4," ") + "  " + k);
}
