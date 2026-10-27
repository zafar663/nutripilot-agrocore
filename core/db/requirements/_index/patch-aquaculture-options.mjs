/**
 * Patch requirements.options.v1.json — Aquaculture types/breeds/phases
 * Source: NRC 2011 Nutrient Requirements of Fish and Shrimp
 */
import fs from "fs";

const OPTIONS_PATH = "C:/Users/Administrator/My Drive/NutriPilot/nutripilot-agrocore/core/db/requirements/_index/requirements.options.v1.json";

const raw = fs.readFileSync(OPTIONS_PATH, "utf8");
const options = JSON.parse(raw);

const backupPath = OPTIONS_PATH.replace(".json", `.bak_aqua_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(backupPath, raw, "utf8");
console.log(`✅ Backup: ${backupPath.split("/").pop()}`);

// ── Fix aqua key to match NutrixDB species key ───────────────────────────────
// NutrixDB will use "aquaculture" — but options uses "aqua"
// We keep "aqua" in options and map it in the ingredient loader

// ── TYPES ─────────────────────────────────────────────────────────────────────
options.types["aqua"] = [
  { key: "tilapia",    label: "Tilapia" },
  { key: "catfish",    label: "Catfish" },
  { key: "salmon",     label: "Salmon" },
  { key: "trout",      label: "Trout" },
  { key: "carp",       label: "Carp" },
  { key: "shrimp",     label: "Shrimp / Prawn" },
  { key: "seabass",    label: "Sea Bass" },
  { key: "seabream",   label: "Sea Bream" },
  { key: "pangasius",  label: "Pangasius / Basa" },
  { key: "milkfish",   label: "Milkfish" }
];

// ── PRODUCTIONS ───────────────────────────────────────────────────────────────
options.productions["tilapia"]   = [{ key: "grow_out", label: "Grow-Out" }, { key: "broodstock", label: "Broodstock" }];
options.productions["catfish"]   = [{ key: "grow_out", label: "Grow-Out" }, { key: "broodstock", label: "Broodstock" }];
options.productions["salmon"]    = [{ key: "grow_out", label: "Grow-Out (Sea)" }, { key: "smolt", label: "Smolt" }, { key: "broodstock", label: "Broodstock" }];
options.productions["trout"]     = [{ key: "grow_out", label: "Grow-Out" }, { key: "broodstock", label: "Broodstock" }];
options.productions["carp"]      = [{ key: "grow_out", label: "Grow-Out" }, { key: "fingerling", label: "Fingerling" }];
options.productions["shrimp"]    = [{ key: "grow_out", label: "Grow-Out" }, { key: "broodstock", label: "Broodstock" }, { key: "postlarva", label: "Post-Larva / PL" }];
options.productions["seabass"]   = [{ key: "grow_out", label: "Grow-Out" }, { key: "broodstock", label: "Broodstock" }];
options.productions["seabream"]  = [{ key: "grow_out", label: "Grow-Out" }, { key: "broodstock", label: "Broodstock" }];
options.productions["pangasius"] = [{ key: "grow_out", label: "Grow-Out" }];
options.productions["milkfish"]  = [{ key: "grow_out", label: "Grow-Out" }, { key: "fry", label: "Fry" }];

// ── BREEDS ────────────────────────────────────────────────────────────────────
options.breeds["tilapia"]   = [{ key: "generic", label: "Generic" }, { key: "nile", label: "Nile Tilapia (O. niloticus)" }, { key: "gift", label: "GIFT Strain" }, { key: "red_tilapia", label: "Red Tilapia" }];
options.breeds["catfish"]   = [{ key: "generic", label: "Generic" }, { key: "channel", label: "Channel Catfish" }, { key: "african", label: "African Catfish (Clarias)" }, { key: "hybrid", label: "Hybrid Catfish" }];
options.breeds["salmon"]    = [{ key: "generic", label: "Generic" }, { key: "atlantic", label: "Atlantic Salmon" }, { key: "chinook", label: "Chinook / King" }, { key: "coho", label: "Coho" }];
options.breeds["trout"]     = [{ key: "generic", label: "Generic" }, { key: "rainbow", label: "Rainbow Trout" }, { key: "brown", label: "Brown Trout" }, { key: "brook", label: "Brook Trout" }];
options.breeds["carp"]      = [{ key: "generic", label: "Generic" }, { key: "common", label: "Common Carp" }, { key: "grass", label: "Grass Carp" }, { key: "silver", label: "Silver Carp" }, { key: "bighead", label: "Bighead Carp" }];
options.breeds["shrimp"]    = [{ key: "generic", label: "Generic" }, { key: "vannamei", label: "L. vannamei (Whiteleg)" }, { key: "monodon", label: "P. monodon (Black Tiger)" }, { key: "stylirostris", label: "L. stylirostris" }];
options.breeds["seabass"]   = [{ key: "generic", label: "Generic" }, { key: "european", label: "European Sea Bass" }, { key: "asian", label: "Asian Sea Bass (Barramundi)" }];
options.breeds["seabream"]  = [{ key: "generic", label: "Generic" }, { key: "gilthead", label: "Gilthead Sea Bream" }, { key: "red", label: "Red Sea Bream" }];
options.breeds["pangasius"] = [{ key: "generic", label: "Generic" }, { key: "hypophthalmus", label: "P. hypophthalmus" }];
options.breeds["milkfish"]  = [{ key: "generic", label: "Generic" }];

// ── PHASES ────────────────────────────────────────────────────────────────────
const fishPhases = [
  { key: "fry",        label: "Fry (< 1g)" },
  { key: "fingerling", label: "Fingerling (1–10g)" },
  { key: "juvenile",   label: "Juvenile (10–50g)" },
  { key: "grower",     label: "Grower (50–200g)" },
  { key: "finisher",   label: "Finisher (200g+)" },
  { key: "broodstock", label: "Broodstock" }
];

const shrimpPhases = [
  { key: "postlarva",  label: "Post-Larva (PL1–PL20)" },
  { key: "juvenile",   label: "Juvenile (0.1–2g)" },
  { key: "grower",     label: "Grower (2–10g)" },
  { key: "finisher",   label: "Finisher (10g+)" },
  { key: "broodstock", label: "Broodstock" }
];

for (const type of ["tilapia","catfish","salmon","trout","carp","seabass","seabream","pangasius","milkfish"]) {
  options.phases[type] = fishPhases;
}
options.phases["shrimp"] = shrimpPhases;

// ── Write ─────────────────────────────────────────────────────────────────────
fs.writeFileSync(OPTIONS_PATH, JSON.stringify(options, null, 2), "utf8");
console.log("✅ Aquaculture types, breeds, phases added");
console.log(`📊 Total species: ${options.species.length}`);
console.log("   " + options.species.map(s => s.label).join(" · "));
