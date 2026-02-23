"use strict";

const fs = require("fs");
const path = require("path");

function readJson(p) {
  let raw = fs.readFileSync(p, "utf8");
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const iObj = raw.indexOf("{");
  const iArr = raw.indexOf("[");
  const i = (iObj === -1) ? iArr : (iArr === -1 ? iObj : Math.min(iObj, iArr));
  if (i > 0) raw = raw.slice(i);
  return JSON.parse(raw);
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[%()]/g, " ")
    .replace(/[^\w\s\/\.\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function main() {
  const src = path.resolve(__dirname, "..", "core", "db", "ingredients", "ingredients.br.v1.json");
  const out = path.resolve(__dirname, "..", "core", "db", "aliases", "poultry", "br", "v1", "aliases.poultry.br.v1.json");

  const j = readJson(src);
  const ing = j.ingredients || {};

  const aliases = {};
  for (const [id, row] of Object.entries(ing)) {
    const dn = row?.display_name || id;

    const candidates = [
      norm(dn),
      norm(dn).replace(/\s+/g, "_"),
      norm(dn).replace(/\s+/g, ""),
      norm(id).replace(/_/g, " "),
      norm(id),
    ];

    for (const a of candidates) {
      if (!a) continue;
      if (!aliases[a]) aliases[a] = id;
    }
  }

  const outObj = {
    _LOCK: {
      status: "LOCKED",
      schema: "nutripilot.aliases.v1",
      region: "BR",
      note: "Generated from display_name and IDs. No source references stored.",
      generated_at: new Date().toISOString(),
    },
    aliases,
  };

  writeJson(out, outObj);
  console.log("Wrote:", out);
  console.log("Aliases:", Object.keys(aliases).length);
}

main();
