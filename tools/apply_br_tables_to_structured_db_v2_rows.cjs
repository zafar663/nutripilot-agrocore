"use strict";

const fs = require("fs");
const path = require("path");

/**
 * tools/apply_br_tables_to_structured_db_v2_rows.cjs
 *
 * v3.2 — TABLE-HEADING MODE + stronger key inference + hard junk guards
 *
 * Problem observed in v7f:
 * - Many nutrient_rows have missing r.key, especially AA labels like "phenylalanine, %"
 * - Some nutrient_rows contain non-nutrient junk ("=", "+", numbers, "intake g/day", etc.)
 *
 * Fixes in v3.2:
 * - inferKeyFromLabel() expanded for missing-key amino acids and proximate synonyms
 * - isJunkRowLabel() hardened: rejects symbols-only / digits-only / obvious narrative fragments
 * - Keeps conservative table scope filter (equations/requirements skipped unless BR_APPLY_ALL_TABLES=1)
 *
 * Env:
 * - BR_APPLY_ALL_TABLES=1  => include "equations/requirements" tables too
 * - BR_DEBUG=1             => print first 20 table heading resolutions + brief stats
 */

function readJson(p) {
  let raw = fs.readFileSync(p, "utf8");
  if (raw && raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip BOM
  return JSON.parse(raw);
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function stripDiacritics(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Conservative normalization for matching.
 */
function norm(s) {
  let x = String(s || "").toLowerCase();
  x = x.replace(/\u00a0/g, " ");
  x = stripDiacritics(x);

  x = x.replace(/[(),;:]/g, " ");
  x = x.replace(/[\/\\|]/g, " ");
  x = x.replace(/[\[\]\{\}]/g, " ");
  x = x.replace(/[_+=]/g, " ");
  x = x.replace(/-/g, " ");

  // keep word-ish + dot + percent
  x = x.replace(/[^\w\s\.%]/g, " ");
  x = x.replace(/\s+/g, " ").trim();

  // PT stopwords (safe)
  const stop = new Set(["de", "da", "do", "das", "dos", "e", "em", "para", "com", "sem"]);
  const toks = x.split(" ").filter(Boolean).filter((t) => !stop.has(t));
  return toks.join(" ").trim();
}

function firstNumber(arr) {
  if (!Array.isArray(arr)) return null;
  for (const x of arr) {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isDigitsOnly(s) {
  const t = String(s || "").trim();
  return !!t && /^[0-9]+(\.[0-9]+)?$/.test(t);
}

/**
 * Hard junk filter for row labels.
 * Keep this conservative: only reject labels that are clearly not nutrients.
 */
function isJunkRowLabel(labelRaw) {
  const raw = String(labelRaw || "").trim();
  const s = norm(raw);
  if (!s) return true;

  // symbols / separators / placeholders
  if (raw === "=" || raw === "+" || raw === "-" || raw === "*" || raw === "/" || raw === "\\") return true;
  if (s === "=" || s === "+" || s === "-" || s === "x") return true;

  // numbers-only labels
  if (isDigitsOnly(raw) || isDigitsOnly(s)) return true;

  // common narrative fragments (from your sample)
  const badContains = [
    "using the equations",
    "equations in tables",
    "equations in table",
    "tables",
    "reared at",
    "days",
    "age",
    "weight range",
    "average weight",
    "intake g day",
    "gain g day",
    "estimated feed intake",
    "diet metab energy",
    "brazilian tables for poultry and swine",
  ];
  for (const b of badContains) {
    if (s.includes(b)) return true;
  }

  // table headers / column headers
  const exactBad = new Set([
    "mean n sd",
    "mean n",
    "mean",
    "sd",
    "n",
    "min",
    "max",
    "main components",
    "macro minerals",
    "minerals",
    "trace minerals",
    "energy",
    "values of poultry and swine feedstuffs as fed",
    "values of poultry and swine feedstuffs as fed cont",
    "pav non phytate p total p phytate p",
  ]);
  if (exactBad.has(s)) return true;

  // pathological very short tokens
  if (s.length <= 1) return true;

  return false;
}

/**
 * Infer nutrient key from label text when r.key is missing.
 * Conservative: only maps when very clear.
 *
 * IMPORTANT: this is where we fix your top missing-key offenders:
 * - phenylalanine, %  => total_phe
 * - tyrosine, %       => total_tyr
 * - alanine, %        => total_ala
 * - proline, %        => total_pro
 * - glycine, %        => total_gly
 * - serine, %         => total_ser
 * - aspartic acid², % => total_asp
 * - glutamic acid², % => total_glu
 * - asparagine², %    => total_asn
 * - glutamine², %     => total_gln
 */
function inferKeyFromLabel(labelRaw) {
  const s = norm(labelRaw);
  if (!s) return null;

  // ---- amino acids (total) commonly present with ", %" ----
  // Primary ones already in your DB writes
  if (s.startsWith("lysine")) return "total_lys";
  if (s.startsWith("methionine")) return "total_met";
  if (s.startsWith("threonine")) return "total_thr";
  if (s.startsWith("tryptophan")) return "total_trp";
  if (s.startsWith("arginine")) return "total_arg";
  if (s.startsWith("valine")) return "total_val";
  if (s.startsWith("isoleucine")) return "total_ile";
  if (s.startsWith("leucine")) return "total_leu";
  if (s.startsWith("histidine")) return "total_his";
  if (s.startsWith("cysteine") || s.startsWith("cystine")) return "total_cys";
  if (s.startsWith("met cys") || (s.includes("met") && s.includes("cys"))) return "total_metcys";
  if (s.startsWith("phe tyr") || (s.includes("phe") && s.includes("tyr"))) return "total_phe_tyr";
  if (s.startsWith("gly ser") || (s.includes("gly") && s.includes("ser"))) return "total_gly_ser";

  // NEW: common “missing key” amino acids in v7f
  if (s.startsWith("phenylalanine")) return "total_phe";
  if (s.startsWith("tyrosine")) return "total_tyr";
  if (s.startsWith("glycine")) return "total_gly";
  if (s.startsWith("serine")) return "total_ser";
  if (s.startsWith("alanine")) return "total_ala";
  if (s.startsWith("proline")) return "total_pro";
  if (s.startsWith("aspartic acid")) return "total_asp";
  if (s.startsWith("glutamic acid")) return "total_glu";
  if (s.startsWith("asparagine")) return "total_asn";
  if (s.startsWith("glutamine")) return "total_gln";

  // ---- proximate / energy ----
  if (s.startsWith("dry matter")) return "dm";
  if (s.startsWith("crude protein")) return "cp";
  // NOTE: Do NOT map "Total nitrogen (PB/6.25)" to cp. It frequently injects the constant 6.25 into values and can overwrite true CP rows.
  if (s.startsWith("total nitrogen") && s.includes("6.25")) return null;
  if (s.startsWith("gross energy")) return "ge";
  if (s.startsWith("metabolizable energy")) return "me";
  if (s.startsWith("apparent metabolizable energy")) return "amen";
  if (s.startsWith("net energy")) return "ne";
  if (s.startsWith("ether extract")) return "ee";
  if (s.startsWith("ash")) return "ash";
  if (s.startsWith("starch")) return "starch";
  if (s.startsWith("sugars")) return "sugars";
  if (s.startsWith("crude fiber")) return "cf";
  if (s === "ndf") return "ndf";
  if (s === "adf") return "adf";

  // ---- minerals / electrolytes ----
  if (s.startsWith("total calcium") || s === "calcium ca") return "ca";
  if (s.startsWith("total phosphorus") || s === "phosphorus p") return "p_total";
  if (s.startsWith("available p") || s.includes("pav")) return "avp";
  if (s.startsWith("phytate p")) return "p_phytate";
  if (s.startsWith("sodium")) return "na";
  if (s.startsWith("potassium")) return "k";
  if (s.startsWith("chlorine") || s.startsWith("chloride") || s === "cl") return "cl";
  if (s.startsWith("magnesium")) return "mg";
  if (s.startsWith("sulfur")) return "s";

  // ---- trace minerals (mg/kg) ----
  if (s.startsWith("iron")) return "fe_mg_kg";
  if (s.startsWith("manganese")) return "mn_mg_kg";
  if (s.startsWith("zinc")) return "zn_mg_kg";
  if (s.startsWith("copper")) return "cu_mg_kg";
  if (s.startsWith("selenium")) return "se_mg_kg";

  // ---- digestible phosphorus ----
  if (s.includes("dig p")) return "dig_p";

  return null;
}

/**
 * Build label -> ingredient ID resolution.
 * Sources:
 * - labelAli (dedicated heading aliases for BR ingestion)
 * - ingredient aliases DB
 * - display_name lookup
 * plus contains-best fallback.
 */
function buildResolvers(structuredDb, ingredientAliasesNode, labelAliasesNode) {
  const labelAliasToId = new Map();
  for (const [k, v] of Object.entries(labelAliasesNode || {})) {
    const nk = norm(k);
    const id = String(v || "").trim();
    if (!nk || !id) continue;
    labelAliasToId.set(nk, id);
  }

  const ingredientAliasToId = new Map();
  for (const [k, v] of Object.entries(ingredientAliasesNode || {})) {
    const nk = norm(k);
    const id = String(v || "").trim();
    if (!nk || !id) continue;
    ingredientAliasToId.set(nk, id);
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

    // best contains display_name
    let best = null,
      bestLen = -1;
    for (const [ndn, id] of nameToId.entries()) {
      if (ndn.length < 5) continue;
      if (n.includes(ndn) && ndn.length > bestLen) {
        best = id;
        bestLen = ndn.length;
      }
    }
    if (best) return best;

    // best contains labelAlias
    let bestLA = null,
      bestLALen = -1;
    for (const [ak, id] of labelAliasToId.entries()) {
      if (ak.length < 5) continue;
      if (n.includes(ak) && ak.length > bestLALen) {
        bestLA = id;
        bestLALen = ak.length;
      }
    }
    if (bestLA) return bestLA;

    // best contains ingredientAlias
    let bestIA = null,
      bestIALen = -1;
    for (const [ak, id] of ingredientAliasToId.entries()) {
      if (ak.length < 5) continue;
      if (n.includes(ak) && ak.length > bestIALen) {
        bestIA = id;
        bestIALen = ak.length;
      }
    }
    return bestIA;
  }

  return { resolveLabelToId };
}

function pickRowArray(table) {
  // prefer arrays of objects that have label_raw + values (and possibly key)
  let best = null;
  let bestScore = -1;

  for (const k of Object.keys(table || {})) {
    const v = table[k];
    if (!Array.isArray(v) || v.length < 1) continue;
    const x = v[0];
    if (!x || typeof x !== "object") continue;

    const hasValues = Object.prototype.hasOwnProperty.call(x, "values");
    const hasLabel = Object.prototype.hasOwnProperty.call(x, "label_raw") || Object.prototype.hasOwnProperty.call(x, "label_norm");
    const hasKey = Object.prototype.hasOwnProperty.call(x, "key");

    let score = 0;
    if (hasValues) score += 6;
    if (hasLabel) score += 4;
    if (hasKey) score += 2;
    score += Math.min(v.length, 500) / 50;

    if (score > bestScore) {
      bestScore = score;
      best = { key: k, arr: v };
    }
  }
  return best;
}

/**
 * Default: apply only "composition" tables.
 * With BR_APPLY_ALL_TABLES=1, include everything (but still will be noisy).
 * We keep this conservative because v7f mixes narrative into tables.
 */
function tableInScope(t) {
  const all = process.env.BR_APPLY_ALL_TABLES === "1";
  if (all) return true;

  const title = norm(t && t.title ? t.title : "");
  const h = norm(t && (t.heading_raw || t.heading_norm) ? t.heading_raw || t.heading_norm : "");

  // Skip obvious "equations/requirements/programs"
  const badWords = ["equation", "equations", "requirements", "requirement", "performance", "curves", "curve", "program", "programs", "example"];
  const hitBad = badWords.some((w) => title.includes(w) || h.includes(w));
  if (hitBad) return false;

  return true;
}

function main() {
  const tablesPath = process.argv[2] || path.resolve("tools", "br_tables_parsed.v7f.json");

  const dbPath = path.resolve("core", "db", "ingredients", "poultry", "br", "v1", "ingredients.poultry.br.sid.v1.json");
  const aliPath = path.resolve("core", "db", "aliases", "poultry", "br", "v1", "aliases.poultry.br.v1.json");
  const labelAliPath = path.resolve("core", "db", "ingredients", "poultry", "br", "v1", "aliases.poultry.br.labels.v1.json");

  const jTables = readJson(tablesPath);
  const tables = jTables.tables || [];

  const structured = readJson(dbPath);
  const targetDb = structured.db ? structured.db : structured;

  const aliasesJ = readJson(aliPath);
  const ingredientAliasesNode = aliasesJ.aliases || aliasesJ.db || aliasesJ.map || {};

  let labelAliasesNode = {};
  if (fs.existsSync(labelAliPath)) {
    const la = readJson(labelAliPath);
    labelAliasesNode = la.map || la.aliases || la.db || la || {};
  }

  const { resolveLabelToId } = buildResolvers(targetDb, ingredientAliasesNode, labelAliasesNode);

  // stats
  let tablesConsidered = 0;
  let tablesSkippedOutOfScope = 0;
  let tablesSkippedNoHeading = 0;
  let tablesWithHeadingOrTitle = 0;
  let tablesHeadingResolved = 0;
  let tablesHeadingUnresolved = 0;

  let rowsSeen = 0;
  let rowsResolved = 0;
  let rowsUnresolved = 0;

  let rowsSkippedNoHeading = 0;
  let rowsSkippedJunkLabel = 0;
  let rowsSkippedKeyMissing = 0;
  let rowsSkippedNoNumeric = 0;

  const perKeyWrites = new Map();
  const unresolved = [];
  let pickedArrayKey = null;

  let dbgCount = 0;

  for (const t of tables) {
    tablesConsidered++;

    if (!tableInScope(t)) {
      tablesSkippedOutOfScope++;
      continue;
    }

    const picked = pickRowArray(t);
    if (!picked) continue;
    if (!pickedArrayKey) pickedArrayKey = picked.key;

    const rows = picked.arr;

    const heading = t.heading_raw || t.heading_norm || "";
    const title = t.title || "";
    const tableLabel = heading || title;

    if (!tableLabel) {
      tablesSkippedNoHeading++;
      continue;
    }
    tablesWithHeadingOrTitle++;

    let tableIngredientId = null;
    const resolvedId = resolveLabelToId(tableLabel);
    if (resolvedId && targetDb[resolvedId]) {
      tableIngredientId = resolvedId;
      tablesHeadingResolved++;
    } else {
      tablesHeadingUnresolved++;
    }

    if (process.env.BR_DEBUG === "1" && dbgCount < 20) {
      dbgCount++;
      console.log("[DBG table]", {
        table_no: t.table_no,
        page: t.page,
        title: t.title,
        heading_raw: t.heading_raw,
        heading_method: t.heading_method,
        tableLabel,
        resolvedId,
        resolvedOk: !!tableIngredientId,
        rows: Array.isArray(rows) ? rows.length : 0,
      });
    }

    for (const r of rows) {
      rowsSeen++;

      const labelRaw = r && (r.label_raw || r.label_norm || r.feedstuff || r.ingredient) ? (r.label_raw || r.label_norm || r.feedstuff || r.ingredient) : "";
      if (!labelRaw) {
        rowsSkippedKeyMissing++;
        continue;
      }

      if (isJunkRowLabel(labelRaw)) {
        rowsSkippedJunkLabel++;
        continue;
      }

      // Determine nutrient key (prefer explicit r.key, otherwise infer)
      let key = r.key || "";
      if (!key) key = inferKeyFromLabel(labelRaw) || "";

      if (!key) {
        rowsSkippedKeyMissing++;
        continue;
      }

      const v = firstNumber(r.values);
      if (v === null) {
        rowsSkippedNoNumeric++;
        continue;
      }

      if (!tableIngredientId) {
        // fallback to row label resolving (rare, but safe)
        const id2 = resolveLabelToId(labelRaw);
        if (!id2 || !targetDb[id2]) {
          rowsUnresolved++;
          if (unresolved.length < 250) {
            unresolved.push({
              mode: "row_fallback_unresolved",
              table_no: t.table_no ?? null,
              page: t.page ?? null,
              title: t.title ?? null,
              heading_raw: t.heading_raw ?? null,
              heading_method: t.heading_method ?? null,
              row_label_raw: labelRaw || null,
              inferred_key: key || null,
              values: r.values,
            });
          }
          continue;
        }
        targetDb[id2][key] = v;
        rowsResolved++;
        perKeyWrites.set(key, (perKeyWrites.get(key) || 0) + 1);
        continue;
      }

      // main write
      targetDb[tableIngredientId][key] = v;
      rowsResolved++;
      perKeyWrites.set(key, (perKeyWrites.get(key) || 0) + 1);
    }
  }

  // annotate lock
  if (structured._LOCK && typeof structured._LOCK === "object") {
    structured._LOCK.last_applied_tables = path.basename(tablesPath);
    structured._LOCK.last_applied_at = new Date().toISOString();
    structured._LOCK.last_apply_mode = "v3.2_TABLE_HEADING_MODE_inferKeyFromLabel_expanded";
    structured._LOCK.last_apply_label_alias_file = fs.existsSync(labelAliPath) ? path.basename(labelAliPath) : null;
    structured._LOCK.note = (structured._LOCK.note || "") + " | populated from BR tables (v3.2).";
  }

  writeJson(dbPath, structured);

  console.log(" Updated DB:", dbPath);
  console.log("tables_total:", tables.length);
  console.log("tables_considered:", tablesConsidered);
  console.log("tables_skipped_out_of_scope:", tablesSkippedOutOfScope);
  console.log("rows_seen:", rowsSeen);
  console.log("tables_with_heading_or_title:", tablesWithHeadingOrTitle);
  console.log("tables_skipped_no_heading:", tablesSkippedNoHeading);
  console.log("tables_heading_resolved:", tablesHeadingResolved);
  console.log("tables_heading_unresolved:", tablesHeadingUnresolved);
  console.log("rows_resolved:", rowsResolved);
  console.log("rows_unresolved:", rowsUnresolved);
  console.log("rows_skipped_no_heading:", rowsSkippedNoHeading);
  console.log("rows_skipped_junk_label:", rowsSkippedJunkLabel);
  console.log("rows_skipped_key_missing:", rowsSkippedKeyMissing);
  console.log("rows_skipped_no_numeric:", rowsSkippedNoNumeric);
  console.log("total_field_writes:", rowsResolved);
  console.log("picked_rows_array_key:", pickedArrayKey);
  console.log("BR_APPLY_ALL_TABLES:", process.env.BR_APPLY_ALL_TABLES === "1" ? "1 (ON)" : "0 (default)");

  console.log("Top 40 keys written:");
  for (const [k, n] of Array.from(perKeyWrites.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    console.log(n, k);
  }

  if (unresolved.length) {
    const outUn = path.resolve("tools", "br_unresolved_rows.sample.json");
    writeJson(outUn, { sample: unresolved });
    console.log(" Wrote unresolved sample:", outUn);
  }
}

main();
