"use strict";

/**
 * agrocore/api/routes/ingest.route.js (ESM)
 *
 * ingest_route_v29_pctfirst_blockpick_noarrow_2026-02-18
 *
 * WHY v29:
 * Your PDF text lines are GLUED: "Maize 27.45274.570.000960.673"
 * That contains pct + weight + cost etc in one token stream.
 *
 * v27/v28 hybrid scan (2-number/1-number) can pick the wrong column
 * and/or drop real ingredients because chosen values exceed 100.
 *
 * v29 strategy:
 * 1) Deglue a bit (kept)
 * 2) ✅ PCT-FIRST per-line extraction:
 *    - for each line, find the FIRST percent-like number (0..60)
 *    - treat that as inclusion and IGNORE the rest of the glued columns
 * 3) ✅ Ignore nutrient-table arrows "=> ..." and other junk lines
 * 4) ✅ Soft gate + dedup by canonical (keep max inclusion)
 * 5) ✅ Block pick: choose region with most resolvable hits
 *
 * Output:
 * - formula_text uses a display name (keeps "SBM 44", "Fish Meal 54")
 * - internal gating uses canonical keys
 */

import express from "express";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import pdfParse from "pdf-parse";
import xlsx from "xlsx";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const router = express.Router();

const INGEST_ROUTE_VERSION =
  "ingest_route_v29_pctfirst_blockpick_noarrow_2026-02-18";

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 5);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// debug switch
const INGEST_DEBUG = String(process.env.INGEST_DEBUG || "") === "1";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

function toNum(str) {
  if (str == null) return null;
  const s = String(str).replace(/,/g, "").replace(/[^\d.\-]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function norm(text) {
  return String(text || "").replace(/[ \t]{2,}/g, " ").trim();
}
function lc(s) {
  return String(s || "").toLowerCase().trim();
}
function alphaCount(s) {
  const m = String(s || "").match(/[a-z]/gi);
  return m ? m.length : 0;
}
function isPureNumberName(name) {
  return /^[0-9]+(\.[0-9]+)?$/.test(String(name || "").trim());
}

function degluePdfText(raw) {
  let t = String(raw || "");
  t = t.replace(/\u00A0/g, " ");

  // letters <-> digits spacing
  t = t.replace(/([A-Za-z])([0-9])/g, "$1 $2");
  t = t.replace(/([0-9])([A-Za-z])/g, "$1 $2");

  // split glued decimals like 0.0800.8008 -> 0.080 0.8008
  for (let i = 0; i < 3; i++) {
    t = t.replace(/(\d\.\d+)(?=\d+\.)/g, "$1 ");
  }

  // remove trailing dot after numbers "0.800800."
  t = t.replace(/(\d)\.(\s|$)/g, "$1$2");

  t = t.replace(/[ \t]{2,}/g, " ");
  return t;
}

const HARD_JUNK_SUBSTR = [
  "values",
  "min",
  "max",
  "target",
  "actual",
  "weight",
  "rates",
  "rate",
  "cost",
  "bag",
  "kg",
  "rs",
  "codes",
  "remarks",
  "date",
  "plant",
  "formula",
  "summary",
  "profile",
  "nutrition",
  "nutrients",
  "non-abbr",
  "low",
];

const NUTRIENT_WORDS = [
  "nfe",
  "ash",
  "cf",
  "ee",
  "fat",
  "fiber",
  "fibre",
  "dm",
  "cp",
  "me",
  "ca",
  "na",
  "k",
  "cl",
  "avp",
  "deb",
  "p",
];

function looksJunky(name) {
  const n = lc(name);
  if (!n) return true;

  // ignore nutrient-arrow lines from report tables
  if (n.startsWith("=>")) return true;

  // ban single letter tokens like "P"
  if (/^[a-z]$/.test(n)) return true;

  if (n.startsWith("total")) return true;
  if (n.startsWith("av. p")) return true;
  if (n.includes("av. p")) return true;
  if (n.includes("non-abbr")) return true;
  if (n === "low" || n.startsWith("low ")) return true;

  if (isPureNumberName(n)) return true;
  if (n === "x") return true;

  for (const bad of HARD_JUNK_SUBSTR) {
    if (n.includes(bad)) return true;
  }

  if (NUTRIENT_WORDS.includes(n)) return true;

  const compact = n.replace(/\s+/g, "");
  for (const w of NUTRIENT_WORDS) {
    if (compact === w) return true;
    if (compact.startsWith(w) && /[0-9]/.test(compact.slice(w.length)))
      return true;
  }

  // very short alpha signals are often noise
  if (alphaCount(n) < 3) return true;

  return false;
}

// ---- Reported nutrient extraction ----
function extractReportedFromPdfText(text) {
  const t = norm(text);

  function grab(labelRe) {
    const re = new RegExp(`${labelRe.source}\\s*([0-9]+(?:\\.[0-9]+)?)`, "i");
    const m = t.match(re);
    return m ? toNum(m[1]) : null;
  }

  const out = {};
  const total = grab(/\bTotal\b/);
  const reported_total =
    total != null && total > 50 && total < 150 ? total : null;

  out.dm = grab(/\bDM\b/);
  out.me = grab(/\bME\b/);
  out.cp = grab(/\bCP\b/);

  out.ca = grab(/\bCa\b/);
  out.avp = grab(/\bAv\.?\s*P\b/);
  out.na = grab(/\bNa\b/);
  out.k = grab(/\bK\b/);
  out.cl = grab(/\bCl\b/);
  out.deb = grab(/\bDEB\b/);

  out.sid_met = grab(/\bMeth\s*\(D\)\b/);
  out.sid_lys = grab(/\bLysine\s*\(D\)\b/);
  out.sid_thr = grab(/\bThreo\s*\(D\)\b/);
  out.sid_trp = grab(/\bTryp\s*\(D\)\b/);
  out.sid_arg = grab(/\bArg\s*\(D\)\b/);
  out.sid_metcys = grab(/\bM\+C\s*\(D\)\b/);

  for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
  return { reported_nutrients: out, reported_total };
}

// ---- Alias resolver (core is CJS) ----
let resolveAlias = null;
function getResolveAlias() {
  if (resolveAlias) return resolveAlias;
  const mod = require("../../../core/aliases/resolveAlias.cjs");
  resolveAlias = mod.resolveAlias;
  return resolveAlias;
}

function cleanName(text) {
  return (text || "")
    .toLowerCase()
    .trim()
    .replace(/[%]/g, "") // keep grade digits but drop percent symbol
    .replace(/[(),]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ");
}

// fallback bridge (tiny)
const FALLBACK_CANONICAL = {
  "rice broken": "rice_broken",
  "broken rice": "rice_broken",
  "fish meal": "fish_meal",
  "millet bajra": "millet_bajra",
  "millet/bajra": "millet_bajra",
  bajra: "millet_bajra",

  "soyabean oil": "soybean_oil",
  "soybean oil": "soybean_oil",
  "soya oil": "soybean_oil",

  dlm: "dl_met",
  "dl met": "dl_met",
  "dl-methionine": "dl_met",

  "c g": "corn_gluten",
  cg: "corn_gluten",
  "corn gluten": "corn_gluten",
  "corn gluten meal": "corn_gluten",

  "vitamin premix": "vitamin_premix",
  "mineral premix": "mineral_premix",
  "anti coccidial": "anti_coccidial",
  "anti-coccidial": "anti_coccidial",
  "toxin binder": "toxin_binder",
};

function normalizeDisplayName(raw) {
  // keep grade tokens but remove stray punctuation
  let s = String(raw || "").trim();
  s = s.replace(/[%]/g, ""); // "SBM 44%"
  s = s.replace(/[ \t]{2,}/g, " ");
  return s.trim();
}

function tryResolveToCanonical(rawName) {
  try {
    const ra = getResolveAlias();
    const cleaned = cleanName(rawName);

    const r = ra(cleaned);
    const canonical = r?.canonical_key || null;

    if (canonical) {
      if (INGEST_DEBUG) {
        console.log("[DBG alias]", {
          raw: rawName,
          cleaned,
          canonical,
          via: "resolveAlias",
        });
      }
      return canonical;
    }

    const fb = FALLBACK_CANONICAL[cleaned] || null;
    if (fb) {
      if (INGEST_DEBUG) {
        console.log("[DBG alias]", {
          raw: rawName,
          cleaned,
          canonical: fb,
          via: "fallback",
        });
      }
      return fb;
    }

    if (INGEST_DEBUG) console.log("[DBG alias MISS]", { raw: rawName, cleaned });
    return null;
  } catch (e) {
    if (INGEST_DEBUG)
      console.log("[DBG alias ERROR]", {
        raw: rawName,
        err: e?.message || String(e),
      });
    return null;
  }
}

// ---- PCT-FIRST scanning ----

// Extract first percent-like number from a line.
// Handles glued stuff: "Maize 27.45274.570.000960.673" -> name "Maize", pct 27.45
function extractPctFirstFromLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;

  // drop arrow nutrition rows entirely
  if (raw.trim().startsWith("=>")) return null;

  // Find first decimal number with 1-3 digits before dot
  // then interpret as "pct" if 0 < pct <= 60
  const m = raw.match(/^(.{2,90}?)(\d{1,3}\.\d{1,4})/);
  if (!m) return null;

  const namePart = String(m[1] || "").trim();
  const pct = toNum(m[2]);

  if (!namePart) return null;
  if (pct == null) return null;
  if (pct <= 0 || pct > 60) return null;

  // reject junk names
  if (looksJunky(namePart)) return null;

  return { name: namePart, pct };
}

function scanCandidatesPctFirst(text) {
  const t = degluePdfText(text);
  const lines = String(t || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const hits = [];
  const seen = new Set();

  for (const line of lines) {
    const got = extractPctFirstFromLine(line);
    if (!got) continue;

    const nm = norm(got.name);
    const pct = got.pct;

    const key = `${lc(nm)}|${pct}`;
    if (seen.has(key)) continue;
    seen.add(key);

    hits.push({ name: nm, pct });
  }

  // biggest first
  hits.sort((a, b) => (b.pct || 0) - (a.pct || 0));
  return hits;
}

// Soft gate + dedup by canonical.
// Keep display name for formula_text, but canonical for gating/dedup.
function softGateAndDedup(rawCandidates) {
  const map = new Map(); // canonical -> { display, canonical, inclusion }

  let unresolved = 0;
  let resolved = 0;

  // ✅ DEBUG ONLY: capture a few unresolved names to prove what got dropped
  const unresolved_samples = [];

  for (const it of rawCandidates) {
    const inclusion = toNum(it.pct);
    if (inclusion == null) continue;
    if (inclusion < 0.001) continue;
    if (inclusion <= 0 || inclusion > 100) continue;

    const display = normalizeDisplayName(it.name);

    const canonical = tryResolveToCanonical(display);
    if (!canonical) {
      unresolved++;
      if (INGEST_DEBUG && unresolved_samples.length < 20) {
        unresolved_samples.push(display);
      }
      continue; // for PDF we only keep resolvable ingredients
    }
    resolved++;

    const prev = map.get(canonical);
    if (!prev || inclusion > prev.inclusion) {
      map.set(canonical, { display, canonical, inclusion });
    }
  }

  const out = Array.from(map.values()).sort(
    (a, b) => (b.inclusion || 0) - (a.inclusion || 0)
  );

  if (INGEST_DEBUG) {
    console.log("[DBG gate]", {
      raw: rawCandidates.length,
      resolved,
      unresolved,
      out: out.length,
      unresolved_samples,
    });
  }

  return {
    out,
    resolved_count: resolved,
    unresolved_count: unresolved,
    unresolved_samples,
  };
}

function chooseSetClosestTo100(items) {
  if (!items.length) return { set: [], sum: 0 };

  const top = items.slice(0, 80);
  const MIN_ING = 8;

  let best = { diff: Infinity, set: [], sum: 0 };

  for (let start = 0; start < Math.min(25, top.length); start++) {
    let sum = 0;
    const set = [];

    for (let i = start; i < top.length; i++) {
      const it = top[i];
      if (sum + it.inclusion > 112) continue;
      set.push(it);
      sum += it.inclusion;
      if (set.length >= 40) break;
      if (sum >= 96 && sum <= 104 && set.length >= MIN_ING) break;
    }

    if (set.length < MIN_ING) continue;

    const diff = Math.abs(sum - 100);
    if (diff < best.diff) best = { diff, set, sum };
    if (diff < 0.1) break;
  }

  if (!best.set.length) {
    const fallback = top.slice(0, 25);
    const sum = fallback.reduce((a, b) => a + b.inclusion, 0);
    return { set: fallback, sum };
  }

  return best;
}

function maybeAutoNormalize(set, sum) {
  if (!set.length) return { set, sum, normalized: false, factor: 1 };
  if (sum > 105 || sum < 95) {
    const factor = 100 / sum;
    const scaled = set.map((it) => ({ ...it, inclusion: it.inclusion * factor }));
    return { set: scaled, sum: 100, normalized: true, factor };
  }
  return { set, sum, normalized: false, factor: 1 };
}

// block pick: choose region with most resolvable hits (pct-first)
// ✅ Minimal change: return { text, start, score } for debug proof
function pickBestRegionText(rawText) {
  const t = degluePdfText(rawText);
  const lines = String(t || "").split(/\r?\n/);
  if (lines.length < 10) return { text: t, start: 0, score: -1 };

  const WINDOW = 80;
  const STEP = 20;
  let best = { score: -1, text: t, start: 0 };

  for (let start = 0; start < lines.length; start += STEP) {
    const chunk = lines.slice(start, start + WINDOW).join("\n");
    const cands = scanCandidatesPctFirst(chunk);

    let resolvable = 0;
    for (const c of cands.slice(0, 60)) {
      if (tryResolveToCanonical(c.name)) resolvable++;
    }

    if (resolvable > best.score) {
      best = { score: resolvable, text: chunk, start };
    }
  }

  return best;
}

function scoreSet(set, sum) {
  const diff = Math.abs(sum - 100);
  const n = set.length;

  const lenPenalty = Math.abs(n - 16) * 50;

  const microKeys =
    /^(phytase|protease|nsps?|toxin_binder|anti_coccidial|choline_chloride|dlm|dl_met|l_lys_hcl|salt)$/i;

  let microMax = 0;
  for (const it of set) {
    if (microKeys.test(it.canonical))
      microMax = Math.max(microMax, it.inclusion);
  }
  if (microMax > 2.0)
    return { ok: false, score: -9999, reason: `micro_too_high(${microMax.toFixed(3)})` };

  const score = 10000 - diff * 250 - lenPenalty;
  return { ok: true, score, reason: "ok" };
}

function extractFormulaFromPdfText(rawText) {
  const pick = pickBestRegionText(rawText);
  const region = pick.text;

  const rawCandidates = scanCandidatesPctFirst(region);
  const gated = softGateAndDedup(rawCandidates);

  const chosen = chooseSetClosestTo100(gated.out);
  const normed = maybeAutoNormalize(chosen.set, chosen.sum);
  const score = scoreSet(normed.set, normed.sum);

  // ✅ IMPORTANT:
  // output DISPLAY names (keeps "SBM 44", "Fish Meal 54") so parser can clarify if needed.
  const formula_text = normed.set
    .map((it) => `${it.display} ${Number(it.inclusion.toFixed(4))}`)
    .join("\n");

  // ✅ DEBUG ONLY: proof of what block pick saw + dropped
  const debug = INGEST_DEBUG
    ? {
        best_region_start: pick.start,
        best_region_score: pick.score,
        candidates_top30: rawCandidates.slice(0, 30).map((c) => ({
          name: c.name,
          pct: c.pct,
        })),
        unresolved_samples: gated.unresolved_samples || [],
      }
    : undefined;

  if (INGEST_DEBUG) {
    console.log("[DBG region_pick]", debug);
  }

  return {
    formula_text,
    formula_lines_count: normed.set.length,
    picked_total: normed.sum,
    candidates: rawCandidates.length,
    method: "pctfirst_blockpick_autonormalize_v29",
    normalized: normed.normalized,
    normalize_factor: normed.factor,
    chosen_column: "PCT_FIRST",
    score_reason: score.reason,
    gated_count: gated.out.length,
    resolved_count: gated.resolved_count,
    unresolved_count: gated.unresolved_count,
    formula_head: formula_text.slice(0, 260),
    debug, // ✅ only present when INGEST_DEBUG=1
  };
}

// ---- ROUTE ----

router.post("/v1/ingest", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        ok: false,
        message: "No file uploaded (field name must be 'file').",
        meta: { route_version: INGEST_ROUTE_VERSION },
      });
    }

    const filename = file.originalname || "upload";
    const mime = file.mimetype || "application/octet-stream";
    const size_bytes = file.size || 0;

    let detected = null;
    try {
      detected = await fileTypeFromBuffer(file.buffer);
    } catch {
      detected = null;
    }

    const detected_mime = detected?.mime || mime;
    const detected_ext = detected?.ext || "";

    console.log("[INGEST_AUDIT] received", {
      filename,
      size_bytes,
      mime,
      detected_mime,
      detected_ext,
      max_upload_mb: MAX_UPLOAD_MB,
      route_version: INGEST_ROUTE_VERSION,
    });

    // PDF
    if (
      detected_mime === "application/pdf" ||
      mime === "application/pdf" ||
      detected_ext === "pdf"
    ) {
      const pdf = await pdfParse(file.buffer);
      const text = pdf?.text || "";

      const rep = extractReportedFromPdfText(text);
      const f = extractFormulaFromPdfText(text);

      console.log("[INGEST_AUDIT] pdf_parsed", {
        filename,
        text_len: text.length,
        candidates: f.candidates,
        gated_count: f.gated_count,
        resolved_count: f.resolved_count,
        unresolved_count: f.unresolved_count,
        formula_lines: f.formula_lines_count,
        picked_total: Number(f.picked_total.toFixed(4)),
        method: f.method,
        normalized: f.normalized,
        normalize_factor: Number(f.normalize_factor.toFixed(6)),
        chosen_column: f.chosen_column,
        score_reason: f.score_reason,
        reported_keys: Object.keys(rep.reported_nutrients || {}).length,
        reported_total: rep.reported_total,
        route_version: INGEST_ROUTE_VERSION,
      });

      if (INGEST_DEBUG && f.debug) {
        console.log("[INGEST_AUDIT] debug", f.debug);
      }

      console.log("[INGEST_AUDIT] formula_head", { head: f.formula_head });

      const meta = {
        route_version: INGEST_ROUTE_VERSION,
        detected_mime,
        detected_ext,
        text_len: text.length,
        formula_lines: f.formula_lines_count,
        picked_total: Number(f.picked_total.toFixed(4)),
        method: f.method,
        normalized: f.normalized,
        normalize_factor: f.normalize_factor,
        chosen_column: f.chosen_column,
        gated_count: f.gated_count,
        resolved_count: f.resolved_count,
        unresolved_count: f.unresolved_count,
        reported_nutrients: rep.reported_nutrients || {},
        reported_total: rep.reported_total,
      };

      // ✅ debug-only response meta (no behavior change)
      if (INGEST_DEBUG && f.debug) {
        meta.debug = f.debug;
      }

      return res.json({
        ok: true,
        formula_text: f.formula_text || "",
        ingest: { filename, contentType: "application/pdf" },
        meta,
      });
    }

    // XLSX
    if (
      detected_ext === "xlsx" ||
      detected_mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      String(mime).includes("spreadsheetml")
    ) {
      const wb = xlsx.read(file.buffer, { type: "buffer" });
      const sheetName = wb.SheetNames?.[0];
      const ws = wb.Sheets?.[sheetName];
      const rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: false });

      const items = [];
      for (const row of rows) {
        if (!row || row.length < 2) continue;
        const name = String(row[0] ?? "").trim();
        const inc = toNum(row[1]);
        if (!name || inc == null) continue;
        if (inc < 0.001) continue;
        if (/^total$/i.test(name)) continue;

        if (looksJunky(name)) continue;

        const canonical = tryResolveToCanonical(name);
        if (!canonical) continue;

        items.push({ display: normalizeDisplayName(name), canonical, inclusion: inc });
      }

      const map = new Map();
      for (const it of items) {
        const prev = map.get(it.canonical);
        if (!prev || it.inclusion > prev.inclusion) map.set(it.canonical, it);
      }

      const out = Array.from(map.values()).sort((a, b) => b.inclusion - a.inclusion);
      const formula_text = out.map((it) => `${it.display} ${it.inclusion}`).join("\n");

      return res.json({
        ok: true,
        formula_text,
        ingest: { filename, contentType: detected_mime || mime },
        meta: {
          route_version: INGEST_ROUTE_VERSION,
          detected_mime,
          detected_ext,
          rows: rows.length,
          items: out.length,
          reported_nutrients: {},
          reported_total: null,
        },
      });
    }

    return res.status(415).json({
      ok: false,
      message: `Unsupported file type: ${detected_mime || mime} (${detected_ext || "unknown"})`,
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  } catch (e) {
    console.error("[INGEST_AUDIT] error", e?.message || e);
    return res.status(500).json({
      ok: false,
      message: e?.message || "Ingest failed",
      meta: { route_version: INGEST_ROUTE_VERSION },
    });
  }
});

export default router;
