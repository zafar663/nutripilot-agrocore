"use strict";

const fs = require("fs");
const path = require("path");

function readJsonSmart(p) {
  const buf = fs.readFileSync(p);
  // Detect UTF-16LE by presence of lots of NUL bytes in even/odd positions
  let text;
  const hasNul = buf.includes(0);
  if (hasNul) {
    // Most common in Windows is UTF-16LE
    text = buf.toString("utf16le");
  } else {
    text = buf.toString("utf8");
  }

  // Strip BOM if present
  text = text.replace(/^\uFEFF/, "");

  // Strip any remaining NULs just in case
  text = text.replace(/\u0000/g, "");

  // Trim leading/trailing whitespace
  text = text.trim();

  try {
    return JSON.parse(text);
  } catch (e) {
    const head = text.slice(0, 120).replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    throw new Error(`Invalid JSON in: ${p}\nHead: ${head}\n${e.message}`);
  }
}

function writeJsonUtf8(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function ensure(obj, key, fallback) {
  if (!obj[key]) obj[key] = fallback;
  return obj[key];
}
function ensureProfile(profiles, key, obj) {
  if (!profiles[key]) profiles[key] = obj;
}

function main() {
  const root = process.cwd();

  // -------------------------
  // 1) LAYER LIB: add 9 breeder profiles (inherit only; no invented numbers)
  // -------------------------
  const layerLibPath = path.join(root, "core/db/requirements/poultry/layer/v1/requirements.library.poultry.layer.v1.json");
  const layerLib = readJsonSmart(layerLibPath);
  const layerProfiles = ensure(layerLib, "profiles", {});

  const eggEarly  = "poultry_layer_generic_early_v1";
  const eggPrelay = "poultry_layer_generic_prelay_v1";
  const eggPeak   = "poultry_layer_generic_peak_v1";

  // Generic breeder
  ensureProfile(layerProfiles, "poultry_layer_breeder_generic_rearing_v1", {
    label: "Layer Breeder Rearing (Generic) v1",
    production: "breeder",
    phase: "rearing",
    inherits: eggEarly,
    targets_override: {}
  });
  ensureProfile(layerProfiles, "poultry_layer_breeder_generic_prelay_v1", {
    label: "Layer Breeder Prelay (Generic) v1",
    production: "breeder",
    phase: "prelay",
    inherits: eggPrelay,
    targets_override: {}
  });
  ensureProfile(layerProfiles, "poultry_layer_breeder_generic_lay_v1", {
    label: "Layer Breeder Lay (Generic) v1",
    production: "breeder",
    phase: "lay",
    inherits: eggPeak,
    targets_override: {}
  });

  // Hy-Line W-36 breeder
  ensureProfile(layerProfiles, "poultry_layer_breeder_hyline_w36_rearing_v1", {
    label: "Layer Breeder Rearing (Hy-Line W-36) v1",
    production: "breeder",
    phase: "rearing",
    inherits: "poultry_layer_breeder_generic_rearing_v1",
    targets_override: {}
  });
  ensureProfile(layerProfiles, "poultry_layer_breeder_hyline_w36_prelay_v1", {
    label: "Layer Breeder Prelay (Hy-Line W-36) v1",
    production: "breeder",
    phase: "prelay",
    inherits: "poultry_layer_breeder_generic_prelay_v1",
    targets_override: {}
  });
  ensureProfile(layerProfiles, "poultry_layer_breeder_hyline_w36_lay_v1", {
    label: "Layer Breeder Lay (Hy-Line W-36) v1",
    production: "breeder",
    phase: "lay",
    inherits: "poultry_layer_breeder_generic_lay_v1",
    targets_override: {}
  });

  // Lohmann LSL breeder
  ensureProfile(layerProfiles, "poultry_layer_breeder_lohmann_lsl_rearing_v1", {
    label: "Layer Breeder Rearing (Lohmann LSL) v1",
    production: "breeder",
    phase: "rearing",
    inherits: "poultry_layer_breeder_generic_rearing_v1",
    targets_override: {}
  });
  ensureProfile(layerProfiles, "poultry_layer_breeder_lohmann_lsl_prelay_v1", {
    label: "Layer Breeder Prelay (Lohmann LSL) v1",
    production: "breeder",
    phase: "prelay",
    inherits: "poultry_layer_breeder_generic_prelay_v1",
    targets_override: {}
  });
  ensureProfile(layerProfiles, "poultry_layer_breeder_lohmann_lsl_lay_v1", {
    label: "Layer Breeder Lay (Lohmann LSL) v1",
    production: "breeder",
    phase: "lay",
    inherits: "poultry_layer_breeder_generic_lay_v1",
    targets_override: {}
  });

  writeJsonUtf8(layerLibPath, layerLib);

  // -------------------------
  // 2) BROILER BREEDER LIB: add ross/cobb rearing+prelay (inherit only)
  // -------------------------
  const bbLibPath = path.join(root, "core/db/requirements/poultry/broiler_breeder/v1/requirements.library.poultry.broiler_breeder.v1.json");
  const bbLib = readJsonSmart(bbLibPath);
  const bbProfiles = ensure(bbLib, "profiles", {});

  const genRearing = "poultry_broiler_breeder_generic_rearing_v1";
  const genPrelay  = "poultry_broiler_breeder_generic_prelay_v1";

  ensureProfile(bbProfiles, "poultry_broiler_breeder_ross308_rearing_v1", {
    label: "Broiler Breeder Rearing (Ross 308) v1",
    phase: "rearing",
    inherits: genRearing,
    targets_override: {}
  });
  ensureProfile(bbProfiles, "poultry_broiler_breeder_ross308_prelay_v1", {
    label: "Broiler Breeder Prelay (Ross 308) v1",
    phase: "prelay",
    inherits: genPrelay,
    targets_override: {}
  });

  ensureProfile(bbProfiles, "poultry_broiler_breeder_cobb500_rearing_v1", {
    label: "Broiler Breeder Rearing (Cobb 500) v1",
    phase: "rearing",
    inherits: genRearing,
    targets_override: {}
  });
  ensureProfile(bbProfiles, "poultry_broiler_breeder_cobb500_prelay_v1", {
    label: "Broiler Breeder Prelay (Cobb 500) v1",
    phase: "prelay",
    inherits: genPrelay,
    targets_override: {}
  });

  writeJsonUtf8(bbLibPath, bbLib);

  console.log("✅ Libraries updated (smart read + utf8 write):");
  console.log(" -", layerLibPath);
  console.log(" -", bbLibPath);
}

main();
