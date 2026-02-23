import fs from "fs";

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error("Usage: node tools/add_adjust_policy_all.mjs <ingredients_json>");
  process.exit(1);
}

const j = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
if (!j.ingredients || typeof j.ingredients !== "object") throw new Error("JSON missing .ingredients object");

let added = 0;
for (const [key, ing] of Object.entries(j.ingredients)) {
  // dm_pct: optional. If missing, leave null so no DM scaling is applied.
  if (ing.dm_pct === undefined) ing.dm_pct = null;

  // adjust_policy: default OFF until dm_pct is provided.
  if (!ing.adjust_policy || typeof ing.adjust_policy !== "object") {
    ing.adjust_policy = {
      dm_scale: { enabled: false, ref_dm_pct: 88 },
      aa_cp_ratio: { enabled: false, cp_ref: null }
    };
    added++;
  } else {
    // ensure keys exist
    ing.adjust_policy.dm_scale = ing.adjust_policy.dm_scale || { enabled: false, ref_dm_pct: 88 };
    ing.adjust_policy.aa_cp_ratio = ing.adjust_policy.aa_cp_ratio || { enabled: false, cp_ref: null };
  }
}

fs.writeFileSync(jsonPath, JSON.stringify(j, null, 2), "utf8");
console.log("OK: adjust_policy scaffold ensured. new_policies_added=" + added);
