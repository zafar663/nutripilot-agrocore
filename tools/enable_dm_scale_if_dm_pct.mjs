import fs from "fs";

const jsonPath = process.argv[2];
if (!jsonPath) { console.error("Usage: node tools/enable_dm_scale_if_dm_pct.mjs <ingredients_json>"); process.exit(1); }

const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
let changed = 0;

for (const ing of Object.values(j.ingredients)) {
  if (typeof ing.dm_pct === "number" && ing.dm_pct > 0) {
    if (!ing.adjust_policy) ing.adjust_policy = {};
    if (!ing.adjust_policy.dm_scale) ing.adjust_policy.dm_scale = { enabled:false, ref_dm_pct: 88 };
    if (ing.adjust_policy.dm_scale.enabled !== true) { ing.adjust_policy.dm_scale.enabled = true; changed++; }
  }
}

fs.writeFileSync(jsonPath, JSON.stringify(j, null, 2), "utf8");
console.log("OK: enabled dm_scale where dm_pct present. changed=" + changed);
