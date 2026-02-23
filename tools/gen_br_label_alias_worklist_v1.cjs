"use strict";

const fs = require("fs");
const path = require("path");

function readJson(p) {
  let raw = fs.readFileSync(p, "utf8");
  if (raw && raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}
function stripDiacritics(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function norm(s) {
  let x = String(s || "").toLowerCase();
  x = x.replace(/\u00a0/g, " ");
  x = stripDiacritics(x);
  x = x.replace(/[(),;:]/g, " ");
  x = x.replace(/[\/\\|]/g, " ");
  x = x.replace(/[\[\]\{\}]/g, " ");
  x = x.replace(/[_+=]/g, " ");
  x = x.replace(/-/g, " ");
  x = x.replace(/[^\w\s\.%]/g, " ");
  x = x.replace(/\s+/g, " ").trim();
  const stop = new Set(["de", "da", "do", "das", "dos", "e", "em", "para", "com", "sem"]);
  const toks = x.split(" ").filter(Boolean).filter(t => !stop.has(t));
  return toks.join(" ").trim();
}

function buildResolvers(structuredDb, ingredientAliasesNode, labelAliasesNode) {
  const labelAliasToId = new Map();
  for (const [k, v] of Object.entries(labelAliasesNode || {})) {
    const nk = norm(k);
    const id = String(v || "").trim();
    if (nk && id) labelAliasToId.set(nk, id);
  }

  const ingredientAliasToId = new Map();
  for (const [k, v] of Object.entries(ingredientAliasesNode || {})) {
    const nk = norm(k);
    const id = String(v || "").trim();
    if (nk && id) ingredientAliasToId.set(nk, id);
  }

  const nameToId = new Map();
  for (const [id, row] of Object.entries(structuredDb || {})) {
    const dn = row && row.display_name ? String(row.display_name) : "";
    const ndn = norm(dn);
    if (ndn && !nameToId.has(ndn)) nameToId.set(ndn, id);
  }

  function resolveLabelToId(labelRaw) {
    const n = norm(labelRaw);
    if (!n) return null;

    if (labelAliasToId.has(n)) return labelAliasToId.get(n);
    if (ingredientAliasToId.has(n)) return ingredientAliasToId.get(n);
    if (nameToId.has(n)) return nameToId.get(n);

    // contains best
    let best = null, bestLen = -1;
    for (const [ndn, id] of nameToId.entries()) {
      if (ndn.length < 5) continue;
      if (n.includes(ndn) && ndn.length > bestLen) { best = id; bestLen = ndn.length; }
    }
    return best;
  }

  return { resolveLabelToId, nameToId };
}

function main() {
  const tablesPath = process.argv[2] || path.resolve("tools", "br_tables_parsed.v7f.json");
  const dbPath = path.resolve("core", "db", "ingredients", "poultry", "br", "v1", "ingredients.poultry.br.sid.v1.json");
  const aliPath = path.resolve("core", "db", "aliases", "poultry", "br", "v1", "aliases.poultry.br.v1.json");
  const labelAliPath = path.resolve("core", "db", "ingredients", "poultry", "br", "v1", "aliases.poultry.br.labels.v1.json");

  const tablesJ = readJson(tablesPath);
  const tables = tablesJ.tables || [];

  const structured = readJson(dbPath);
  const DB = structured.db ? structured.db : structured;

  const aliasesJ = readJson(aliPath);
  const ingredientAliasesNode = aliasesJ.aliases || aliasesJ.db || aliasesJ.map || {};

  let labelAliasesNode = {};
  if (fs.existsSync(labelAliPath)) {
    const la = readJson(labelAliPath);
    labelAliasesNode = la.map || la.aliases || la.db || la || {};
  }

  const { resolveLabelToId } = buildResolvers(DB, ingredientAliasesNode, labelAliasesNode);

  // heading frequency
  const freq = new Map();
  const freqNorm = new Map();

  for (const t of tables) {
    const h = String(t.heading_raw || "").trim();
    if (!h) continue;
    const hn = norm(h);
    if (!hn) continue;
    freq.set(h, (freq.get(h) || 0) + 1);
    freqNorm.set(hn, (freqNorm.get(hn) || 0) + 1);
  }

  const headings = Array.from(freq.entries())
    .map(([raw, count]) => ({ raw, norm: norm(raw), count }))
    .sort((a, b) => b.count - a.count);

  const mapped = [];
  const unmapped = [];

  for (const h of headings) {
    const id = resolveLabelToId(h.raw);
    if (id && DB[id]) mapped.push({ ...h, id });
    else unmapped.push(h);
  }

  writeJson(path.resolve("tools", "br_heading_freq.json"), headings.slice(0, 500));
  writeJson(path.resolve("tools", "br_heading_mapped.json"), mapped.slice(0, 500));
  writeJson(path.resolve("tools", "br_heading_unmapped.json"), unmapped.slice(0, 500));

  console.log("tables:", tables.length);
  console.log("unique_headings:", headings.length);
  console.log("mapped:", mapped.length);
  console.log("unmapped:", unmapped.length);
  console.log("wrote: tools/br_heading_freq.json");
  console.log("wrote: tools/br_heading_mapped.json");
  console.log("wrote: tools/br_heading_unmapped.json");
  console.log("top unmapped (30):");
  for (const x of unmapped.slice(0, 30)) {
    console.log(String(x.count).padStart(4, " "), x.raw);
  }
}

main();
