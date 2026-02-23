import fs from "fs";

const jsonPath = process.argv[2];
const dmPct = Number(process.argv[3] || 88);

if (!jsonPath) {
  console.error("Usage: node tools/set_dm_all.mjs <jsonPath> [dm_pct]");
  process.exit(1);
}
if (!Number.isFinite(dmPct) || dmPct <= 0) {
  throw new Error("dm_pct must be > 0");
}

const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
if (!j.ingredients || typeof j.ingredients !== "object") {
  throw new Error("JSON missing .ingredients object");
}

let changed = 0;

for (const ing of Object.values(j.ingredients)) {
  ing.dm_pct = dmPct;

  ing.adjust_policy = ing.adjust_policy || {};
  ing.adjust_policy.dm_scale = ing.adjust_policy.dm_scale || { enabled: false, ref_dm_pct: 88 };
  ing.adjust_policy.dm_scale.enabled = true;
  ing.adjust_policy.dm_scale.ref_dm_pct = 88;

  changed++;
}

fs.writeFileSync(jsonPath, JSON.stringify(j, null, 2), "utf8");
console.log("OK: set dm_pct=" + dmPct + " and enabled dm_scale for ingredients=" + changed);
