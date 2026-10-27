/**
 * Patch requirements.options.v1.json to add
 * Dairy, Beef, Sheep, Goat types/productions/breeds/phases
 */
import fs from "fs";

const OPTIONS_PATH = "C:/Users/Administrator/My Drive/NutriPilot/nutripilot-agrocore/core/db/requirements/_index/requirements.options.v1.json";

const raw = fs.readFileSync(OPTIONS_PATH, "utf8");
const options = JSON.parse(raw);

// ── Backup ────────────────────────────────────────────────────────────────────
const backupPath = OPTIONS_PATH.replace(".json", `.bak_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(backupPath, raw, "utf8");
console.log(`✅ Backup: ${backupPath.split("/").pop()}`);

// ── Add goat as separate species ──────────────────────────────────────────────
const hasGoat = options.species.some(s => s.key === "goat");
if (!hasGoat) {
  // Insert goat after sheep
  const sheepIdx = options.species.findIndex(s => s.key === "sheep");
  options.species.splice(sheepIdx + 1, 0, { key: "goat", label: "Goat" });
  // Also rename sheep label to just "Sheep"
  options.species.find(s => s.key === "sheep").label = "Sheep";
  console.log("✅ Added goat species, renamed sheep");
}

// ── TYPES ─────────────────────────────────────────────────────────────────────
const newTypes = {
  dairy: [
    { key: "cow", label: "Dairy Cow" },
    { key: "heifer", label: "Heifer" },
    { key: "calf", label: "Calf" }
  ],
  beef: [
    { key: "cow_calf", label: "Cow-Calf" },
    { key: "stocker", label: "Stocker / Backgrounder" },
    { key: "feedlot", label: "Feedlot" },
    { key: "bull", label: "Breeding Bull" }
  ],
  sheep: [
    { key: "ewe", label: "Ewe" },
    { key: "lamb", label: "Lamb" },
    { key: "ram", label: "Ram" }
  ],
  goat: [
    { key: "doe", label: "Doe (Dairy / Meat)" },
    { key: "kid", label: "Kid" },
    { key: "buck", label: "Buck" }
  ]
};

for (const [species, types] of Object.entries(newTypes)) {
  if (!options.types[species]) {
    options.types[species] = types;
    console.log(`✅ Added types for ${species}`);
  }
}

// ── PRODUCTIONS ───────────────────────────────────────────────────────────────
const newProductions = {
  cow: [
    { key: "lactation", label: "Lactation" },
    { key: "dry", label: "Dry Period" },
    { key: "transition", label: "Transition (Close-up)" },
    { key: "fresh", label: "Fresh Cow" }
  ],
  heifer: [
    { key: "growing", label: "Growing" },
    { key: "bred", label: "Bred Heifer" }
  ],
  calf: [
    { key: "preruminant", label: "Pre-ruminant (Milk Fed)" },
    { key: "starter", label: "Starter / Weaning" },
    { key: "grower", label: "Grower" }
  ],
  cow_calf: [
    { key: "cow_maintenance", label: "Cow Maintenance" },
    { key: "cow_gestation", label: "Cow Late Gestation" },
    { key: "cow_lactation", label: "Cow Lactation" },
    { key: "calf_creep", label: "Calf Creep" }
  ],
  stocker: [
    { key: "growing", label: "Growing" },
    { key: "backgrounding", label: "Backgrounding" }
  ],
  feedlot: [
    { key: "receiving", label: "Receiving" },
    { key: "growing", label: "Growing" },
    { key: "finishing", label: "Finishing" }
  ],
  bull: [
    { key: "maintenance", label: "Maintenance" },
    { key: "breeding", label: "Breeding Season" }
  ],
  ewe: [
    { key: "maintenance", label: "Maintenance" },
    { key: "flushing", label: "Flushing" },
    { key: "early_gestation", label: "Early Gestation" },
    { key: "late_gestation", label: "Late Gestation" },
    { key: "early_lactation", label: "Early Lactation" },
    { key: "late_lactation", label: "Late Lactation" }
  ],
  lamb: [
    { key: "starter", label: "Starter" },
    { key: "grower", label: "Grower" },
    { key: "finisher", label: "Finisher / Feedlot" }
  ],
  ram: [
    { key: "maintenance", label: "Maintenance" },
    { key: "breeding", label: "Breeding Season" }
  ],
  doe: [
    { key: "maintenance", label: "Maintenance" },
    { key: "late_gestation", label: "Late Gestation" },
    { key: "early_lactation", label: "Early Lactation (Peak)" },
    { key: "mid_lactation", label: "Mid Lactation" },
    { key: "late_lactation", label: "Late Lactation" }
  ],
  kid: [
    { key: "starter", label: "Starter" },
    { key: "grower", label: "Grower" },
    { key: "finisher", label: "Finisher" }
  ],
  buck: [
    { key: "maintenance", label: "Maintenance" },
    { key: "breeding", label: "Breeding Season" }
  ]
};

for (const [type, prods] of Object.entries(newProductions)) {
  if (!options.productions[type]) {
    options.productions[type] = prods;
  }
}
console.log("✅ Added productions for dairy, beef, sheep, goat");

// ── BREEDS ────────────────────────────────────────────────────────────────────
const newBreeds = {
  cow: [
    { key: "generic", label: "Generic" },
    { key: "holstein", label: "Holstein" },
    { key: "jersey", label: "Jersey" },
    { key: "brown_swiss", label: "Brown Swiss" },
    { key: "ayrshire", label: "Ayrshire" },
    { key: "guernsey", label: "Guernsey" },
    { key: "crossbred", label: "Crossbred" }
  ],
  heifer: [
    { key: "generic", label: "Generic" },
    { key: "holstein", label: "Holstein" },
    { key: "jersey", label: "Jersey" },
    { key: "crossbred", label: "Crossbred" }
  ],
  calf: [
    { key: "generic", label: "Generic" },
    { key: "holstein", label: "Holstein" },
    { key: "jersey", label: "Jersey" }
  ],
  cow_calf: [
    { key: "generic", label: "Generic" },
    { key: "angus", label: "Angus" },
    { key: "hereford", label: "Hereford" },
    { key: "simmental", label: "Simmental" },
    { key: "brahman", label: "Brahman" },
    { key: "brangus", label: "Brangus" },
    { key: "crossbred", label: "Crossbred" }
  ],
  stocker: [
    { key: "generic", label: "Generic" },
    { key: "angus_cross", label: "Angus Cross" },
    { key: "british_cross", label: "British Cross" }
  ],
  feedlot: [
    { key: "generic", label: "Generic" },
    { key: "high_yielding", label: "High Yielding" },
    { key: "british_cross", label: "British Cross" },
    { key: "continental_cross", label: "Continental Cross" }
  ],
  bull: [
    { key: "generic", label: "Generic" },
    { key: "angus", label: "Angus" },
    { key: "hereford", label: "Hereford" }
  ],
  ewe: [
    { key: "generic", label: "Generic" },
    { key: "merino", label: "Merino" },
    { key: "dorper", label: "Dorper" },
    { key: "suffolk", label: "Suffolk" },
    { key: "dorset", label: "Dorset" },
    { key: "rambouillet", label: "Rambouillet" },
    { key: "crossbred", label: "Crossbred" }
  ],
  lamb: [
    { key: "generic", label: "Generic" },
    { key: "merino", label: "Merino" },
    { key: "dorper", label: "Dorper" },
    { key: "suffolk", label: "Suffolk" },
    { key: "crossbred", label: "Crossbred" }
  ],
  ram: [
    { key: "generic", label: "Generic" },
    { key: "merino", label: "Merino" },
    { key: "suffolk", label: "Suffolk" }
  ],
  doe: [
    { key: "generic", label: "Generic" },
    { key: "saanen", label: "Saanen" },
    { key: "alpine", label: "Alpine" },
    { key: "nubian", label: "Nubian" },
    { key: "toggenburg", label: "Toggenburg" },
    { key: "boer", label: "Boer" },
    { key: "lamancha", label: "LaMancha" },
    { key: "crossbred", label: "Crossbred" }
  ],
  kid: [
    { key: "generic", label: "Generic" },
    { key: "boer", label: "Boer" },
    { key: "dairy_cross", label: "Dairy Cross" }
  ],
  buck: [
    { key: "generic", label: "Generic" },
    { key: "boer", label: "Boer" },
    { key: "saanen", label: "Saanen" },
    { key: "nubian", label: "Nubian" }
  ]
};

for (const [type, breeds] of Object.entries(newBreeds)) {
  if (!options.breeds[type]) {
    options.breeds[type] = breeds;
  }
}
console.log("✅ Added breeds for dairy, beef, sheep, goat");

// ── PHASES ────────────────────────────────────────────────────────────────────
const newPhases = {
  cow: [
    { key: "early_lactation", label: "Early Lactation (0-70 DIM)" },
    { key: "peak_lactation", label: "Peak Lactation (70-150 DIM)" },
    { key: "mid_lactation", label: "Mid Lactation (150-250 DIM)" },
    { key: "late_lactation", label: "Late Lactation (250+ DIM)" },
    { key: "dry_far_off", label: "Dry — Far Off (>21d pre-calving)" },
    { key: "dry_close_up", label: "Dry — Close Up (≤21d pre-calving)" }
  ],
  heifer: [
    { key: "growing", label: "Growing" },
    { key: "bred", label: "Bred" }
  ],
  calf: [
    { key: "preruminant", label: "Pre-ruminant (0-8 wk)" },
    { key: "weaning", label: "Weaning (8-12 wk)" },
    { key: "post_weaning", label: "Post-Weaning (3-6 mo)" }
  ],
  cow_calf: [
    { key: "early_gestation", label: "Early Gestation" },
    { key: "late_gestation", label: "Late Gestation" },
    { key: "early_lactation", label: "Early Lactation" },
    { key: "mid_late_lactation", label: "Mid-Late Lactation" }
  ],
  stocker: [
    { key: "receiving", label: "Receiving" },
    { key: "growing", label: "Growing" }
  ],
  feedlot: [
    { key: "receiving", label: "Receiving / Adaptation" },
    { key: "growing", label: "Growing" },
    { key: "finishing", label: "Finishing" }
  ],
  bull: [
    { key: "maintenance", label: "Maintenance" },
    { key: "breeding", label: "Breeding" }
  ],
  ewe: [
    { key: "maintenance", label: "Maintenance" },
    { key: "flushing", label: "Flushing / Pre-mating" },
    { key: "early_gestation", label: "Early Gestation (0-100d)" },
    { key: "late_gestation", label: "Late Gestation (100-147d)" },
    { key: "early_lactation", label: "Early Lactation (0-6 wk)" },
    { key: "late_lactation", label: "Late Lactation (6+ wk)" }
  ],
  lamb: [
    { key: "creep", label: "Creep (pre-weaning)" },
    { key: "starter", label: "Starter (weaning-20 kg)" },
    { key: "grower", label: "Grower (20-35 kg)" },
    { key: "finisher", label: "Finisher (35+ kg)" }
  ],
  ram: [
    { key: "maintenance", label: "Maintenance" },
    { key: "breeding", label: "Breeding" }
  ],
  doe: [
    { key: "maintenance", label: "Maintenance / Dry" },
    { key: "late_gestation", label: "Late Gestation" },
    { key: "early_lactation", label: "Early Lactation (Peak)" },
    { key: "mid_lactation", label: "Mid Lactation" },
    { key: "late_lactation", label: "Late Lactation" }
  ],
  kid: [
    { key: "milk_fed", label: "Milk Fed (0-8 wk)" },
    { key: "starter", label: "Starter (8-16 wk)" },
    { key: "grower", label: "Grower (4-7 mo)" },
    { key: "finisher", label: "Finisher (7+ mo)" }
  ],
  buck: [
    { key: "maintenance", label: "Maintenance" },
    { key: "breeding", label: "Breeding Season" }
  ]
};

for (const [type, phases] of Object.entries(newPhases)) {
  if (!options.phases[type]) {
    options.phases[type] = phases;
  }
}
console.log("✅ Added phases for dairy, beef, sheep, goat");

// ── Write updated file ────────────────────────────────────────────────────────
fs.writeFileSync(OPTIONS_PATH, JSON.stringify(options, null, 2), "utf8");

console.log("\n✅ requirements.options.v1.json updated successfully");
console.log(`📊 Species count: ${options.species.length}`);
console.log("   " + options.species.map(s => s.label).join(" · "));
