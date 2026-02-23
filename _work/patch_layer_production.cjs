"use strict";
const fs = require("fs");

const p = "./core/db/requirements/poultry/layer/v1/requirements.index.poultry.layer.v1.json";
const raw = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
const j = JSON.parse(raw);

j.productions = (j.productions && typeof j.productions === "object") ? j.productions : {};

if (!j.productions.layer) {
  if (j.productions.egg) {
    j.productions.layer = j.productions.egg;
    console.log("✅ Added productions.layer = productions.egg");
  } else {
    const keys = Object.keys(j.productions);
    if (keys.length) {
      j.productions.layer = j.productions[keys[0]];
      console.log("✅ Added productions.layer = productions[" + keys[0] + "]");
    } else {
      console.log("⚠️ productions exists but empty. No change.");
    }
  }
} else {
  console.log("✅ productions.layer already exists. No change.");
}

fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n", "utf8");
console.log("✅ Wrote:", p);
