"use strict";

const fs = require("fs");
const path = require("path");

/**
 * tools/recompute_sid_from_total_v1.cjs
 *
 * Recompute SID amino acids from Total amino acids using digestibility coefficients
 * (Evonik-style coefficients).
 *
 * Writes: sid_<aa> = total_<aa> * coeff
 *
 * Safety:
 * - Creates a backup of the DB file in ._work before modifying.
 * - Does NOT delete any existing keys.
 * - Only writes sid_* when total_* is finite and coeff is finite.
 *
 * Usage:
 *   node .\tools\recompute_sid_from_total_v1.cjs
 *   node .\tools\recompute_sid_from_total_v1.cjs --db .\core\db\ingredients\poultry\br\v1\ingredients.poultry.br.sid.v1.json
 *   node .\tools\recompute_sid_from_total_v1.cjs --coeff .\core\db\digestibility\poultry\evonik_broiler_sid_coeffs.v1.json
 *   node .\tools\recompute_sid_from_total_v1.cjs --dry-run 1
 *
 * Env:
 * - DRY_RUN=1 same as --dry-run 1
 */

function readJson(p) {
  let raw = fs.readFileSync(p, "utf8");
  if (raw && raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function isFiniteNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v && !v.startsWith("--")) {
      out[k] = v;
      i++;
    } else {
      out[k] = "1";
    }
  }
  return out;
}

/**
 * Coeff file expected shape (flexible):
 * {
 *   "_LOCK": {...},
 *   "defaults": { "lys":0.88, "met":0.90, ... },
 *   "category_overrides": { "grains": { "lys":0.80, ... } },
 *   "overrides": { "soybean_meal_48": { "lys":0.90, ... } }
 * }
 *
 * Notes:
 * - coefficients are FRACTIONS (0..1), not %.
 * - aa keys are short form (lys, met, thr, trp, arg, val, leu, ile, his, cys, phe, tyr, gly, ser, ala, asp, glu, asn, gln, pro)
 */
function normalizeCoeffFile(j) {
  const defaults = (j && j.defaults && typeof j.defaults === "object") ? j.defaults : {};
  const category_overrides =
    (j && j.category_overrides && typeof j.category_overrides === "object") ? j.category_overrides : {};
  const overrides = (j && j.overrides && typeof j.overrides === "object") ? j.overrides : {};

  return { defaults, category_overrides, overrides };
}

/**
 * AA keys we support (single AAs only).
 * We DO NOT compute SID for combo totals like total_metcys, total_phe_tyr, total_gly_ser.
 */
const AA_LIST = [
  "lys", "met", "thr", "trp", "arg",
  "val", "leu", "ile", "his",
  "cys", "phe", "tyr",
  "gly", "ser", "ala",
  "asp", "glu", "asn", "gln",
  "pro"
];

function totalKey(aa) {
  return `total_${aa}`;
}
function sidKey(aa) {
  return `sid_${aa}`;
}

function pickCoeffForIngredient(coeffs, ingId, ingRow) {
  // order: explicit ingredient override > category override > defaults
  const cat = ingRow && ingRow.category ? String(ingRow.category).toLowerCase().trim() : "";

  const base = Object.assign({}, coeffs.defaults || {});
  if (cat && coeffs.category_overrides && coeffs.category_overrides[cat]) {
    Object.assign(base, coeffs.category_overrides[cat]);
  }
  if (coeffs.overrides && coeffs.overrides[ingId]) {
    Object.assign(base, coeffs.overrides[ingId]);
  }
  return base;
}

function main() {
  const args = parseArgs(process.argv);

  const dbPath =
    args.db ||
    path.resolve("core", "db", "ingredients", "poultry", "br", "v1", "ingredients.poultry.br.sid.v1.json");

  const coeffPath =
    args.coeff ||
    path.resolve("core", "db", "digestibility", "poultry", "evonik_broiler_sid_coeffs.v1.json");

  const reportPath =
    args.report ||
    path.resolve("tools", "recompute_sid_from_total.report.json");

  const dryRun = (args["dry-run"] === "1") || (process.env.DRY_RUN === "1");

  if (!fs.existsSync(dbPath)) throw new Error("DB not found: " + dbPath);
  if (!fs.existsSync(coeffPath)) throw new Error("Coeff file not found: " + coeffPath);

  const structured = readJson(dbPath);
  const DB = structured.db ? structured.db : structured;

  const coeffRaw = readJson(coeffPath);
  const coeffs = normalizeCoeffFile(coeffRaw);

  let ingredientsSeen = 0;
  let ingredientsTouched = 0;

  let totalsSeen = 0;
  let sidWrites = 0;

  const perAA = {};
  for (const aa of AA_LIST) perAA[aa] = { totals_present: 0, coeff_present: 0, writes: 0 };

  const unresolved = [];
  const maxUnresolved = 200;

  for (const [ingId, row] of Object.entries(DB)) {
    if (!row || typeof row !== "object") continue;
    ingredientsSeen++;

    const cset = pickCoeffForIngredient(coeffs, ingId, row);
    let touched = false;

    for (const aa of AA_LIST) {
      const tKey = totalKey(aa);
      const sKey = sidKey(aa);

      const tVal = isFiniteNumber(row[tKey]);
      if (tVal === null) continue;

      totalsSeen++;
      perAA[aa].totals_present++;

      const coeff = isFiniteNumber(cset[aa]);
      if (coeff === null) {
        if (unresolved.length < maxUnresolved) {
          unresolved.push({ ingId, aa, reason: "missing_coeff", total_key: tKey, total_val: tVal });
        }
        continue;
      }
      perAA[aa].coeff_present++;

      // sanity: coeff fraction 0..1.2 (allow slight >1 just in case data is odd)
      if (coeff < 0 || coeff > 1.2) {
        if (unresolved.length < maxUnresolved) {
          unresolved.push({ ingId, aa, reason: "bad_coeff_range", coeff });
        }
        continue;
      }

      const sidVal = tVal * coeff;

      if (!dryRun) {
        row[sKey] = Number(sidVal.toFixed(4)); // stable, readable
      }

      sidWrites++;
      perAA[aa].writes++;
      touched = true;
    }

    if (touched) {
      ingredientsTouched++;
    }
  }

  // Backup and write
  if (!dryRun) {
    const stamp = nowStamp();
    const backupDir = path.resolve("_work");
    fs.mkdirSync(backupDir, { recursive: true });

    const backupPath = path.join(
      backupDir,
      path.basename(dbPath).replace(/\.json$/i, "") + `.before_sid_recompute_${stamp}.json`
    );

    fs.copyFileSync(dbPath, backupPath);

    // annotate _LOCK
    if (structured._LOCK && typeof structured._LOCK === "object") {
      structured._LOCK.last_sid_recompute_from_total = {
        at: new Date().toISOString(),
        tool: "recompute_sid_from_total_v1.cjs",
        coeff_file: path.basename(coeffPath),
        dry_run: false,
        aa_count: AA_LIST.length,
        ingredients_seen: ingredientsSeen,
        ingredients_touched: ingredientsTouched,
        totals_seen: totalsSeen,
        sid_writes: sidWrites
      };
    }

    writeJson(dbPath, structured);

    console.log("✅ Backup:", backupPath);
    console.log("✅ Updated DB:", dbPath);
  } else {
    console.log("🟡 DRY_RUN=1 (no DB written)");
  }

  const report = {
    ok: true,
    dry_run: dryRun,
    db: dbPath,
    coeff: coeffPath,
    ingredients_seen: ingredientsSeen,
    ingredients_touched: ingredientsTouched,
    totals_seen: totalsSeen,
    sid_writes: sidWrites,
    per_aa: perAA,
    unresolved_sample: unresolved
  };

  writeJson(reportPath, report);

  console.log("Report:", reportPath);
  console.log("ingredients_seen:", ingredientsSeen);
  console.log("ingredients_touched:", ingredientsTouched);
  console.log("totals_seen:", totalsSeen);
  console.log("sid_writes:", sidWrites);

  console.log("Per AA writes:");
  for (const aa of AA_LIST) {
    const r = perAA[aa];
    if (r.writes > 0) console.log(String(r.writes).padStart(5, " "), aa);
  }

  if (unresolved.length) {
    console.log("Unresolved coeff sample:", unresolved.length, "(see report)");
  }
}

main();