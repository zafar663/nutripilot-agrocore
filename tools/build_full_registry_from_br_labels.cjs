"use strict";
const fs = require("fs");
const path = require("path");

function readJson(p){
  let raw = fs.readFileSync(p,"utf8");
  if (raw.charCodeAt(0)===0xFEFF) raw=raw.slice(1);
  return JSON.parse(raw);
}

function main(){
  const labelsPath = process.argv[2] || path.resolve("tools","br_detected_labels.json");
  if(!fs.existsSync(labelsPath)){
    console.error("Missing:", labelsPath);
    process.exit(1);
  }

  // Canonical engine keys we want supported (MAX set)
  const KEYS = [
    // Energy
    ["ge","Gross Energy","energy","kcal/kg","as_fed"],
    ["de","DE","energy","kcal/kg","as_fed"],
    ["me","ME","energy","kcal/kg","as_fed"],
    ["ame","AME","energy","kcal/kg","as_fed"],
    ["amen","AMEn","energy","kcal/kg","as_fed"],
    ["ne","NE","energy","kcal/kg","as_fed"],
    ["me_hens","ME (hens)","energy","kcal/kg","as_fed"],
    ["de_hens","DE (hens)","energy","kcal/kg","as_fed"],
    ["de_poultry","DE (poultry)","energy","kcal/kg","as_fed"],

    // Proximate / main components
    ["dm","Dry matter","proximate","%","as_fed"],
    ["moisture","Moisture","proximate","%","as_fed"],
    ["om","Organic matter","proximate","%","as_fed"],
    ["ash","Ash","proximate","%","as_fed"],
    ["cp","Crude protein","protein","%","as_fed"],
    ["ee","Ether extract","fat","%","as_fed"],
    ["cf","Crude fiber","fiber","%","as_fed"],
    ["nfe","N-free extract (NFE)","carb","%","as_fed"],
    ["starch","Starch","carb","%","as_fed"],
    ["sugars","Sugars","carb","%","as_fed"],

    // Fiber fractions
    ["ndf","NDF","fiber","%","as_fed"],
    ["adf","ADF","fiber","%","as_fed"],
    ["lignin","Lignin","fiber","%","as_fed"],

    // Fatty acids
    ["linoleic","Linoleic acid","fatty_acid","%","as_fed"],
    ["linolenic","Linolenic acid","fatty_acid","%","as_fed"],
    ["oleic","Oleic acid","fatty_acid","%","as_fed"],
    ["sfa","Saturated FA","fatty_acid","%","as_fed"],
    ["ufa","Unsaturated FA","fatty_acid","%","as_fed"],

    // Macro minerals / electrolytes
    ["ca","Calcium","mineral","%","as_fed"],
    ["p_total","Total P","mineral","%","as_fed"],
    ["avp","Available P (Pav)","mineral","%","as_fed"],
    ["npp","Non-phytate P","mineral","%","as_fed"],
    ["p_phytate","Phytate P","mineral","%","as_fed"],
    ["dig_p","Digestible P","mineral","%","as_fed"],
    ["s","Sulfur","mineral","%","as_fed"],
    ["mg","Magnesium","mineral","%","as_fed"],
    ["na","Sodium","electrolyte","%","as_fed"],
    ["k","Potassium","electrolyte","%","as_fed"],
    ["cl","Chloride","electrolyte","%","as_fed"],
    ["deb","DEB","electrolyte","mEq/kg","as_fed"],

    // Trace minerals (mg/kg)
    ["fe_mg_kg","Iron (Fe)","trace_mineral","mg/kg","as_fed"],
    ["mn_mg_kg","Manganese (Mn)","trace_mineral","mg/kg","as_fed"],
    ["zn_mg_kg","Zinc (Zn)","trace_mineral","mg/kg","as_fed"],
    ["cu_mg_kg","Copper (Cu)","trace_mineral","mg/kg","as_fed"],
    ["i_mg_kg","Iodine (I)","trace_mineral","mg/kg","as_fed"],
    ["se_mg_kg","Selenium (Se)","trace_mineral","mg/kg","as_fed"],

    // Amino acids - Total (%)
    ["total_lys","Total Lys","aa_total","%","as_fed"],
    ["total_met","Total Met","aa_total","%","as_fed"],
    ["total_cys","Total Cys","aa_total","%","as_fed"],
    ["total_metcys","Total Met+Cys","aa_total","%","as_fed"],
    ["total_thr","Total Thr","aa_total","%","as_fed"],
    ["total_trp","Total Trp","aa_total","%","as_fed"],
    ["total_arg","Total Arg","aa_total","%","as_fed"],
    ["total_ile","Total Ile","aa_total","%","as_fed"],
    ["total_leu","Total Leu","aa_total","%","as_fed"],
    ["total_val","Total Val","aa_total","%","as_fed"],
    ["total_his","Total His","aa_total","%","as_fed"],
    ["total_phe","Total Phe","aa_total","%","as_fed"],
    ["total_tyr","Total Tyr","aa_total","%","as_fed"],
    ["total_phe_tyr","Total Phe+Tyr","aa_total","%","as_fed"],
    ["total_gly","Total Gly","aa_total","%","as_fed"],
    ["total_ser","Total Ser","aa_total","%","as_fed"],
    ["total_gly_ser","Total Gly+Ser","aa_total","%","as_fed"],
    ["total_ala","Total Ala","aa_total","%","as_fed"],
    ["total_pro","Total Pro","aa_total","%","as_fed"],
    ["total_asp","Total Asp","aa_total","%","as_fed"],
    ["total_asn","Total Asn","aa_total","%","as_fed"],
    ["total_gln","Total Gln","aa_total","%","as_fed"],
    ["total_glu","Total Glu","aa_total","%","as_fed"],

    // Amino acids - SID (%)
    ["sid_lys","SID Lys","aa_sid","%","as_fed"],
    ["sid_met","SID Met","aa_sid","%","as_fed"],
    ["sid_cys","SID Cys","aa_sid","%","as_fed"],
    ["sid_metcys","SID Met+Cys","aa_sid","%","as_fed"],
    ["sid_thr","SID Thr","aa_sid","%","as_fed"],
    ["sid_trp","SID Trp","aa_sid","%","as_fed"],
    ["sid_arg","SID Arg","aa_sid","%","as_fed"],
    ["sid_ile","SID Ile","aa_sid","%","as_fed"],
    ["sid_leu","SID Leu","aa_sid","%","as_fed"],
    ["sid_val","SID Val","aa_sid","%","as_fed"],
    ["sid_his","SID His","aa_sid","%","as_fed"],
    ["sid_phe_tyr","SID Phe+Tyr","aa_sid","%","as_fed"],
  ];

  const registry = KEYS.map(([key, display_name, category, unit, basis]) => ({
    id: `br.${key}`,
    key,
    display_name,
    category,
    unit_canonical: unit,
    basis,
    derived: (key === "deb"),
    plan_access: { basic:true, core:true, pro:true, elite:true }
  }));

  console.log("=== PASTE THIS REGISTRY ARRAY INTO master_nutrient_registry.v1.json (under nutrients) ===");
  console.log(JSON.stringify(registry, null, 2));
  console.log("\nCount:", registry.length);
}

main();
