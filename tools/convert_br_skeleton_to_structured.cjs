"use strict";

const fs = require("fs");
const path = require("path");

function readJson(p) {
  let raw = fs.readFileSync(p, "utf8");

  // Strip UTF-8 BOM if present
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

  // Also strip any leading nulls/odd control chars before first { or [
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

function main() {
  const src = path.resolve(__dirname, "..", "core", "db", "ingredients", "ingredients.br.v1.json");
  const out = path.resolve(
    __dirname,
    "..",
    "core",
    "db",
    "ingredients",
    "poultry",
    "br",
    "v1",
    "ingredients.poultry.br.sid.v1.json"
  );

  const j = readJson(src);

  const ing = j.ingredients || {};
  const db = {};

  for (const [id, row] of Object.entries(ing)) {
    const nutrients = row?.nutrients && typeof row.nutrients === "object" ? row.nutrients : {};
    db[id] = {
      display_name: row?.display_name || id,
      category: row?.category || null,
      ...nutrients
    };
  }

  const outObj = {
    _LOCK: {
      status: "LOCKED",
      schema: "nutripilot.ingredients.structured.v1",
      region: "BR",
      basis: "sid",
      note: "Generated from BR skeleton; numeric nutrients pending. No source references stored.",
      generated_at: new Date().toISOString()
    },
    db
  };

  writeJson(out, outObj);
  console.log("Wrote:", out);
  console.log("Ingredients:", Object.keys(db).length);
}

main();
