// _work/patch_broiler_add_ir_hubbard_aa_optionb.cjs
// Purpose:
// 1) Make JSON parsing BOM-safe
// 2) Add broiler breeds: hubbard / ir / aa into Option-B index (meat)
// 3) Ensure library profiles exist for those reqKeys (placeholder inherits generic)
//
// NOTE: This creates placeholders (inherits generic + empty override).
// Next step after this: fill targets_override from your PDFs.

"use strict";

const fs = require("fs");
const path = require("path");

function readJson(p) {
  const raw0 = fs.readFileSync(p, "utf8");
  // Strip UTF-8 BOM + any leading weird whitespace
  const raw = raw0.replace(/^\uFEFF/, "").replace(/^\s+/, (m) => (m.includes("{") ? "" : m));
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("❌ JSON parse failed for:", p);
    console.error("   First 80 chars:", JSON.stringify(raw.slice(0, 80)));
    throw e;
  }
}

function writeJson(p, obj) {
  const out = JSON.stringify(obj, null, 2) + "\n";
  fs.writeFileSync(p, out, "utf8"); // no BOM
}

function ensure(obj, key, initVal) {
  if (obj[key] === undefined || obj[key] === null) obj[key] = initVal;
  return obj[key];
}

function main() {
  const idxPath = path.resolve("./core/db/requirements/poultry/broiler/v1/requirements.index.poultry.broiler.v1.json");
  const libPath = path.resolve("./core/db/requirements/poultry/broiler/v1/requirements.library.poultry.broiler.v1.json");

  const idxJ = readJson(idxPath);
  const libJ = readJson(libPath);

  // Normalize library shape: allow {library:{}} or flat object
  const lib = libJ.library || libJ.profiles || libJ;

  // Ensure index productions structure
  ensure(idxJ, "productions", {});
  ensure(idxJ.productions, "meat", {});
  ensure(idxJ.productions.meat, "breeds", {});

  const breeds = idxJ.productions.meat.breeds;

  const phases = ["starter", "grower", "finisher"];

  const desired = {
    hubbard: {
      starter: "poultry_broiler_hubbard_starter_v1",
      grower: "poultry_broiler_hubbard_grower_v1",
      finisher: "poultry_broiler_hubbard_finisher_v1",
    },
    aa: {
      starter: "poultry_broiler_aa_starter_v1",
      grower: "poultry_broiler_aa_grower_v1",
      finisher: "poultry_broiler_aa_finisher_v1",
    },
    ir: {
      starter: "poultry_broiler_ir_starter_v1",
      grower: "poultry_broiler_ir_grower_v1",
      finisher: "poultry_broiler_ir_finisher_v1",
    },
  };

  // Add missing breeds to index
  for (const b of Object.keys(desired)) {
    if (!breeds[b]) breeds[b] = {};
    for (const ph of phases) {
      breeds[b][ph] = desired[b][ph];
    }
  }

  // Ensure placeholder profiles exist in library (inherits generic_*_v1 with empty override)
  for (const b of Object.keys(desired)) {
    for (const ph of phases) {
      const reqKey = desired[b][ph];
      const genericKey = `poultry_broiler_generic_${ph}_v1`;

      if (!lib[reqKey]) {
        lib[reqKey] = {
          inherits: genericKey,
          targets_override: {},
          meta: {
            note: "PLACEHOLDER: created by patch; fill targets_override from breed PDF spec.",
            created_by: "patch_broiler_add_ir_hubbard_aa_optionb.cjs",
          },
        };
      }
    }
  }

  // Write back
  writeJson(idxPath, idxJ);

  // Preserve original wrapper shape for library
  if (libJ.library) {
    libJ.library = lib;
    writeJson(libPath, libJ);
  } else {
    writeJson(libPath, lib);
  }

  console.log("✅ Patched index + ensured library profiles (placeholders).");
  console.log("   INDEX:", idxPath);
  console.log("   LIB:  ", libPath);

  console.log("\nNext: restart server if it was already running (stale in-memory).");
}

main();