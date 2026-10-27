// api/routes/nutrix.release.route.js
// Formula Release System — PDF, CSV, XLSX, XML, WhatsApp
// AgroCore Prime · Session 7 · 2026-05-11

import express from "express";
import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const router = express.Router();
const ROUTE_VERSION = "nutrix_release_v1_2026_05_11";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Helpers ──────────────────────────────────────────────────────────────────

function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function round(v, d = 2) { const n = Number(v); if (!Number.isFinite(n)) return 0; return Number(n.toFixed(d)); }
function pct(v) { return round(num(v), 4); }

export function normalizeRows(rows = [], batchTonnes = 1) {
  const total = rows.reduce((s, r) => s + num(r.inclusion ?? r.percent ?? r.value, 0), 0) || 100;
  return rows
    .map((r, i) => ({
      seq:              i + 1,
      ingredient_id:    r.ingredient_id   || r.id   || `ING${i + 1}`,
      ingredient_name:  r.ingredient_name || r.name || "Unknown",
      inclusion_pct:    round(num(r.inclusion ?? r.percent ?? r.value, 0) / total * 100, 4),
      kg_per_tonne:     round(num(r.inclusion ?? r.percent ?? r.value, 0) / total * 1000, 2),
      kg_per_batch:     round(num(r.inclusion ?? r.percent ?? r.value, 0) / total * 1000 * batchTonnes, 2),
      cost_per_kg:      round(num(r.cost, 0), 4),
      cost_contribution:round(num(r.cost, 0) * num(r.inclusion ?? r.percent ?? r.value, 0) / total * 1000 / 1000, 4),
    }))
    .filter(r => r.inclusion_pct > 0)
    .sort((a, b) => b.inclusion_pct - a.inclusion_pct);
}

export function keyNutrients(profile = {}) {
  const keys = [
    { k: "cp",          label: "Crude Protein",        unit: "%" },
    { k: "me_kcal_kg",  label: "ME",                   unit: "kcal/kg" },
    { k: "me",          label: "ME",                   unit: "kcal/kg" },
    { k: "ca",          label: "Calcium",              unit: "%" },
    { k: "total_p",     label: "Total Phosphorus",     unit: "%" },
    { k: "avp",         label: "Available Phosphorus", unit: "%" },
    { k: "total_lys",   label: "Lysine",               unit: "%" },
    { k: "total_met",   label: "Methionine",           unit: "%" },
    { k: "ee",          label: "Crude Fat",            unit: "%" },
    { k: "cf",          label: "Crude Fiber",          unit: "%" },
    { k: "na",          label: "Sodium",               unit: "%" },
    { k: "moisture",    label: "Moisture",             unit: "%" },
  ];
  const used = new Set();
  return keys
    .filter(k => profile[k.k] != null && !used.has(k.label))
    .map(k => { used.add(k.label); return { label: k.label, value: round(profile[k.k], k.unit === "kcal/kg" ? 0 : 3), unit: k.unit }; });
}

export function buildReleaseData(body) {
  const cfg = body.config || {};
  const batchTonnes = num(cfg.batch_tonnes || body.batch_tonnes, 1);

  return {
    formula_name:   body.product_name || body.formula_name || "Untitled Formula",
    formula_code:   body.formula_code  || cfg.formula_code  || "",
    version:        body.version        || cfg.version        || "v1.0",
    species:        body.species        || "",
    type:           body.type           || "",
    production:     body.production     || "",
    phase:          body.phase          || "",
    released_by:    cfg.released_by    || body.released_by    || "Nutritionist",
    approved_by:    cfg.approved_by    || body.approved_by    || "",
    release_date:   cfg.release_date   || new Date().toLocaleDateString(),
    batch_tonnes:   batchTonnes,
    mixing_instructions: cfg.mixing_instructions || body.mixing_instructions || "",
    special_notes:  cfg.special_notes  || body.special_notes  || "",
    rows:           normalizeRows(body.formula_rows || body.ingredients || [], batchTonnes),
    nutrients:      keyNutrients(body.nutrient_profile || body.nutrients || {}),
    total_cost:     num(body.total_cost || (body.cost_summary || {}).total_cost_per_ton, 0),
    generated_at:   new Date().toISOString(),
    route_version:  ROUTE_VERSION,
  };
}

// ══ ENDPOINTS ════════════════════════════════════════════════════════════════

// ── 1. JSON preview ───────────────────────────────────────────────────────────
router.post("/release", async (req, res) => {
  try {
    const data = buildReleaseData(req.body || {});
    res.json({ ok: true, release: data, route_version: ROUTE_VERSION });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── PDF buffer builder (shared) ───────────────────────────────────────────────
export function buildPdfBuffer(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 40, left: 45, right: 45 } });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
    const DARK = "#1a1f2e"; const GOLD = "#d4a843"; const GREEN = "#2d5a3d";
    const CREAM = "#f8f6f0"; const MUTED = "#7a6f58";
    const L = 45; const W = doc.page.width - 90;

    // ── HEADER ────────────────────────────────────────────────────────────────
    doc.rect(L - 5, 40, W + 10, 70).fill(DARK);

    // APPROVED badge
    doc.roundedRect(L + W - 80, 47, 80, 18, 3).fill(GREEN);
    doc.font("Courier-Bold").fontSize(8).fillColor("#c8e6d0")
       .text("APPROVED RELEASE", L + W - 76, 52, { width: 72, align: "center" });

    doc.font("Times-Bold").fontSize(18).fillColor(CREAM)
       .text(d.formula_name, L + 4, 50, { width: W - 90 });

    const ctx = [d.species, d.type, d.phase].filter(Boolean).join(" · ").toUpperCase();
    if (ctx) doc.font("Courier").fontSize(8).fillColor("#8892a4").text(ctx, L + 4, 74, { width: W - 90 });

    if (d.formula_code) {
      doc.font("Courier-Bold").fontSize(8).fillColor(GOLD)
         .text(`CODE: ${d.formula_code}  VER: ${d.version}`, L + 4, 86, { width: W - 90 });
    }

    doc.rect(L - 5, 110, W + 10, 3).fill(GOLD);

    // ── RELEASE META BAR ─────────────────────────────────────────────────────
    doc.rect(L - 5, 113, W + 10, 28).fill("#f8f6f0");
    const metaItems = [
      { k: "Released by", v: d.released_by },
      { k: "Date",        v: d.release_date },
      { k: "Batch size",  v: `${d.batch_tonnes} tonne(s)` },
      { k: "Version",     v: d.version },
    ];
    if (d.approved_by) metaItems.push({ k: "Approved by", v: d.approved_by });

    const mw = W / metaItems.length;
    metaItems.forEach((m, i) => {
      const mx = L + i * mw;
      doc.font("Courier").fontSize(7).fillColor(MUTED).text(m.k.toUpperCase(), mx + 4, 118, { width: mw - 8 });
      doc.font("Courier-Bold").fontSize(9).fillColor(DARK).text(m.v, mx + 4, 128, { width: mw - 8 });
    });

    doc.rect(L - 5, 141, W + 10, 1).fill("#e0dbd0");

    // ── INGREDIENT TABLE ─────────────────────────────────────────────────────
    let y = 150;

    // Section head
    doc.font("Courier-Bold").fontSize(8).fillColor(MUTED)
       .text("INGREDIENT COMPOSITION", L, y);
    y += 14;

    // Table header
    const cols = { seq: L, name: L + 28, pct: L + 280, kgTon: L + 340, kgBatch: L + 400, cost: L + 468 };
    doc.rect(L - 5, y, W + 10, 18).fill(DARK);
    doc.font("Courier-Bold").fontSize(8).fillColor(CREAM);
    doc.text("#",          cols.seq,     y + 5, { width: 24, align: "center" });
    doc.text("Ingredient", cols.name,    y + 5, { width: 248 });
    doc.text("%",          cols.pct,     y + 5, { width: 52, align: "right" });
    doc.text("kg/tonne",   cols.kgTon,   y + 5, { width: 52, align: "right" });
    doc.text(`kg/${d.batch_tonnes}t`,cols.kgBatch,y+5,{ width: 60, align: "right" });
    doc.text("Cost/kg",    cols.cost,    y + 5, { width: 56, align: "right" });
    y += 18;

    d.rows.forEach((r, i) => {
      const bg = i % 2 === 0 ? "#faf9f6" : "white";
      doc.rect(L - 5, y, W + 10, 16).fill(bg);
      doc.font("Courier-Bold").fontSize(8.5).fillColor(DARK);
      doc.text(String(r.seq),           cols.seq,     y + 4, { width: 24, align: "center" });
      doc.font("Times-Roman").fontSize(9).fillColor("#2a2010");
      doc.text(r.ingredient_name,       cols.name,    y + 4, { width: 246 });
      doc.font("Courier").fontSize(8.5).fillColor(DARK);
      doc.text(r.inclusion_pct.toFixed(2), cols.pct,  y + 4, { width: 52, align: "right" });
      doc.text(r.kg_per_tonne.toFixed(2),  cols.kgTon,y + 4, { width: 52, align: "right" });
      doc.font("Courier-Bold").fontSize(8.5).fillColor(GREEN);
      doc.text(r.kg_per_batch.toFixed(2),  cols.kgBatch,y+4, { width: 60, align: "right" });
      doc.font("Courier").fontSize(8.5).fillColor(DARK);
      doc.text(r.cost_per_kg > 0 ? r.cost_per_kg.toFixed(2) : "—", cols.cost, y + 4, { width: 56, align: "right" });
      y += 16;
    });

    // Totals row
    doc.rect(L - 5, y, W + 10, 18).fill(DARK);
    doc.font("Courier-Bold").fontSize(9).fillColor(GOLD);
    doc.text("TOTAL", cols.name, y + 5, { width: 248 });
    doc.text("100.00", cols.pct,     y + 5, { width: 52,  align: "right" });
    doc.text("1000.00",cols.kgTon,   y + 5, { width: 52,  align: "right" });
    doc.font("Courier-Bold").fontSize(9).fillColor("#c8e6d0");
    doc.text((d.batch_tonnes * 1000).toFixed(2), cols.kgBatch, y + 5, { width: 60, align: "right" });
    if (d.total_cost > 0) {
      doc.font("Courier-Bold").fontSize(9).fillColor(GOLD);
      doc.text(d.total_cost.toFixed(2), cols.cost, y + 5, { width: 56, align: "right" });
    }
    y += 24;

    // ── KEY NUTRIENTS — hidden for mill release ───────────────────────────────────
    if (false) {
      doc.font("Courier-Bold").fontSize(8).fillColor(MUTED)
         .text("KEY NUTRIENT PROFILE", L, y);
      y += 14;

      const nCols = 4;
      const nw = W / nCols;
      d.nutrients.forEach((n, i) => {
        const nx = L + (i % nCols) * nw;
        const ny = y + Math.floor(i / nCols) * 22;
        doc.rect(nx, ny, nw - 4, 20).fill(i % 2 === 0 ? "#f0ede6" : "#faf9f6");
        doc.font("Courier").fontSize(8).fillColor(MUTED).text(n.label, nx + 4, ny + 3, { width: nw - 50 });
        doc.font("Courier-Bold").fontSize(9).fillColor(DARK)
           .text(`${n.value} ${n.unit}`, nx + nw - 60, ny + 3, { width: 56, align: "right" });
      });
      y += (Math.ceil(d.nutrients.length / nCols) + 1) * 22 + 8;
    }

    // ── MIXING INSTRUCTIONS ───────────────────────────────────────────────────
    if (d.mixing_instructions || d.special_notes) {
      doc.rect(L - 5, y, W + 10, 1).fill("#e0dbd0");
      y += 10;
      doc.font("Courier-Bold").fontSize(8).fillColor(MUTED)
         .text("MIXING INSTRUCTIONS / SPECIAL NOTES", L, y);
      y += 12;
      const instText = [d.mixing_instructions, d.special_notes].filter(Boolean).join("\n\n");
      doc.font("Times-Roman").fontSize(10).fillColor("#2a2010")
         .text(instText, L, y, { width: W, lineGap: 2 });
      y = doc.y + 12;
    }

    // ── SIGN-OFF ──────────────────────────────────────────────────────────────
    const signY = Math.max(y + 10, doc.page.height - 100);
    doc.rect(L - 5, signY, W + 10, 1).fill("#e0dbd0");
    doc.font("Courier").fontSize(8).fillColor(MUTED)
       .text("Nutritionist signature: ____________________________", L, signY + 8);
    doc.text("Date: ________________", L + 320, signY + 8);
    doc.font("Courier").fontSize(8).fillColor("#c0b8a8")
       .text(`DO NOT USE IF SUPERSEDED — ${ROUTE_VERSION} — Generated: ${new Date().toLocaleString()}`,
             L, signY + 28, { width: W, align: "center" });

    doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── 2. PDF release sheet ──────────────────────────────────────────────────────
router.post("/release/pdf", async (req, res) => {
  try {
    const d = buildReleaseData(req.body || {});
    const pdf = await buildPdfBuffer(d);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${d.formula_name.replace(/[^a-z0-9]/gi,"_")}_release.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error("[release/pdf]", err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
  }
});

// ── CSV string builder (shared) ───────────────────────────────────────────────
export function buildCsvString(d) {
  const header = [
    "# FORMULA RELEASE SHEET",
    `# Formula: ${d.formula_name}`,
    `# Code: ${d.formula_code}  Version: ${d.version}`,
    `# Species: ${d.species} | Type: ${d.type} | Phase: ${d.phase}`,
    `# Released by: ${d.released_by}  Date: ${d.release_date}`,
    `# Batch size: ${d.batch_tonnes} tonne(s)`,
    "#",
    "Seq,Ingredient ID,Ingredient Name,Inclusion %,kg per tonne,kg per batch,Cost per kg",
  ];

  const rows = d.rows.map(r =>
    `${r.seq},"${r.ingredient_id}","${r.ingredient_name}",${r.inclusion_pct},${r.kg_per_tonne},${r.kg_per_batch},${r.cost_per_kg}`
  );

  const nutrients = [
    "#",
    "# KEY NUTRIENTS",
    "Nutrient,Value,Unit",
    ...d.nutrients.map(n => `"${n.label}",${n.value},"${n.unit}"`),
  ];

  return [...header, ...rows, ...nutrients].join("\r\n");
}

// ── 3. CSV release ────────────────────────────────────────────────────────────
router.post("/release/csv", async (req, res) => {
  try {
    const d = buildReleaseData(req.body || {});
    const csv = buildCsvString(d);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${d.formula_name.replace(/[^a-z0-9]/gi,"_")}_release.csv"`);
    res.send(csv);

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── XLSX buffer builder (shared) ──────────────────────────────────────────────
export function buildXlsxBuffer(d) {
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Formula Release ──
    const wsData = [
      ["FORMULA RELEASE SHEET", "", "", "", "", "", ""],
      ["Formula:", d.formula_name, "", "Code:", d.formula_code, "Version:", d.version],
      ["Species:", d.species, "Type:", d.type, "Phase:", d.phase, ""],
      ["Released by:", d.released_by, "Date:", d.release_date, "Batch:", `${d.batch_tonnes} tonne(s)`, ""],
      [""],
      ["INGREDIENT COMPOSITION", "", "", "", "", "", ""],
      ["#", "Ingredient ID", "Ingredient Name", "Inclusion %", "kg/tonne", `kg/${d.batch_tonnes}t batch`, "Cost/kg"],
      ...d.rows.map(r => [r.seq, r.ingredient_id, r.ingredient_name, r.inclusion_pct, r.kg_per_tonne, r.kg_per_batch, r.cost_per_kg]),
      ["", "", "TOTAL", 100, 1000, d.batch_tonnes * 1000, ""],
      [""],
      ["KEY NUTRIENTS", "", ""],
      ["Nutrient", "Value", "Unit"],
      ...d.nutrients.map(n => [n.label, n.value, n.unit]),
    ];

    if (d.mixing_instructions) {
      wsData.push([""]);
      wsData.push(["MIXING INSTRUCTIONS"]);
      wsData.push([d.mixing_instructions]);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Column widths
    ws["!cols"] = [
      { wch: 5 }, { wch: 18 }, { wch: 32 }, { wch: 14 },
      { wch: 12 }, { wch: 16 }, { wch: 12 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Formula Release");

    // ── Sheet 2: Mill Import (clean, no headers) ──
    const millData = [
      ["ingredient_id", "ingredient_name", "inclusion_pct", "kg_per_tonne", `kg_per_${d.batch_tonnes}t`],
      ...d.rows.map(r => [r.ingredient_id, r.ingredient_name, r.inclusion_pct, r.kg_per_tonne, r.kg_per_batch]),
    ];
    const wsMill = XLSX.utils.aoa_to_sheet(millData);
    wsMill["!cols"] = [{ wch: 18 }, { wch: 32 }, { wch: 14 }, { wch: 12 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsMill, "Mill Import");

    // ── Sheet 3: Nutrients ──
    const nutData = [
      ["Nutrient", "Value", "Unit"],
      ...d.nutrients.map(n => [n.label, n.value, n.unit]),
    ];
    const wsNut = XLSX.utils.aoa_to_sheet(nutData);
    XLSX.utils.book_append_sheet(wb, wsNut, "Nutrients");

    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ── 4. XLSX release ───────────────────────────────────────────────────────────
router.post("/release/xlsx", async (req, res) => {
  try {
    const d = buildReleaseData(req.body || {});
    const buffer = buildXlsxBuffer(d);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${d.formula_name.replace(/[^a-z0-9]/gi,"_")}_release.xlsx"`);
    res.send(buffer);

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── 5. XML release (Bühler/CPM compatible) ────────────────────────────────────
router.post("/release/xml", async (req, res) => {
  try {
    const d = buildReleaseData(req.body || {});

    const esc = s => String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

    const ingredientXml = d.rows.map(r => `
    <ingredient seq="${r.seq}">
      <id>${esc(r.ingredient_id)}</id>
      <name>${esc(r.ingredient_name)}</name>
      <inclusion_pct>${r.inclusion_pct}</inclusion_pct>
      <kg_per_tonne>${r.kg_per_tonne}</kg_per_tonne>
      <kg_per_batch>${r.kg_per_batch}</kg_per_batch>
      <cost_per_kg>${r.cost_per_kg}</cost_per_kg>
    </ingredient>`).join("");

    const nutrientXml = d.nutrients.map(n => `
    <nutrient>
      <name>${esc(n.label)}</name>
      <value>${n.value}</value>
      <unit>${esc(n.unit)}</unit>
    </nutrient>`).join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<formula_release version="1.0" generated="${d.generated_at}">
  <meta>
    <formula_name>${esc(d.formula_name)}</formula_name>
    <formula_code>${esc(d.formula_code)}</formula_code>
    <version>${esc(d.version)}</version>
    <species>${esc(d.species)}</species>
    <type>${esc(d.type)}</type>
    <phase>${esc(d.phase)}</phase>
    <released_by>${esc(d.released_by)}</released_by>
    <release_date>${esc(d.release_date)}</release_date>
    <batch_tonnes>${d.batch_tonnes}</batch_tonnes>
    <total_cost_per_tonne>${d.total_cost}</total_cost_per_tonne>
    <route_version>${ROUTE_VERSION}</route_version>
  </meta>
  <ingredients batch_tonnes="${d.batch_tonnes}">${ingredientXml}
  </ingredients>
  <nutrients>${nutrientXml}
  </nutrients>
  <instructions>
    <mixing>${esc(d.mixing_instructions)}</mixing>
    <notes>${esc(d.special_notes)}</notes>
  </instructions>
</formula_release>`;

    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Content-Disposition", `attachment; filename="${d.formula_name.replace(/[^a-z0-9]/gi,"_")}_release.xml"`);
    res.send(xml);

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── 6. WhatsApp release via Twilio ────────────────────────────────────────────
router.post("/release/whatsapp", async (req, res) => {
  try {
    const body   = req.body || {};
    const d      = buildReleaseData(body);
    const toNum  = body.whatsapp_to || body.phone_number || "";
    const fromNum= process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

    if (!toNum) return res.status(400).json({ ok: false, error: "whatsapp_to is required" });

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      return res.status(500).json({ ok: false, error: "Twilio credentials not configured" });
    }

    // Build WhatsApp message
    const topRows = d.rows.slice(0, 8);
    const ingList = topRows.map(r => `  ${r.seq}. ${r.ingredient_name}: *${r.kg_per_batch} kg*`).join("\n");
    const nutList = d.nutrients.slice(0, 5).map(n => `  ${n.label}: ${n.value} ${n.unit}`).join("\n");

    const msg = `🏭 *FORMULA RELEASE — ${d.formula_name}*
📋 ${[d.species, d.type, d.phase].filter(Boolean).join(" | ")}
📅 ${d.release_date} | Version: ${d.version}
⚖️ Batch: *${d.batch_tonnes} tonne(s)*

*INGREDIENTS (kg per batch):*
${ingList}${d.rows.length > 8 ? `\n  ... +${d.rows.length - 8} more` : ""}

*KEY NUTRIENTS:*
${nutList}
${d.total_cost > 0 ? `\n💰 Cost/tonne: ${d.total_cost.toFixed(2)}` : ""}
${d.mixing_instructions ? `\n📝 *Instructions:* ${d.mixing_instructions.slice(0, 200)}` : ""}

✅ Released by: ${d.released_by}
_Generated by AgroCore Prime_`;

    // Also generate and save PDF for attachment
    let mediaUrl = null;
    try {
      const feedbotPublicBase = process.env.FEEDBOT_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "";
      const reportsDir = path.join(__dirname, "../../feedbot-whatsapp/public/reports");

      if (fs.existsSync(reportsDir) && feedbotPublicBase) {
        // Generate PDF inline
        const pdfDoc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 40, left: 45, right: 45 } });
        const pdfChunks = [];
        pdfDoc.on("data", c => pdfChunks.push(c));
        await new Promise(resolve => {
          pdfDoc.on("end", resolve);
          pdfDoc.font("Times-Bold").fontSize(16).text(`Formula Release: ${d.formula_name}`);
          pdfDoc.moveDown();
          pdfDoc.font("Courier").fontSize(10);
          pdfDoc.text(`Species: ${d.species} | Type: ${d.type} | Phase: ${d.phase}`);
          pdfDoc.text(`Released by: ${d.released_by} | Date: ${d.release_date}`);
          pdfDoc.text(`Batch: ${d.batch_tonnes} tonne(s) | Version: ${d.version}`);
          pdfDoc.moveDown();
          pdfDoc.font("Courier-Bold").text("INGREDIENTS (kg per batch):");
          pdfDoc.font("Courier").fontSize(9);
          d.rows.forEach(r => pdfDoc.text(`  ${r.seq}. ${r.ingredient_name}: ${r.kg_per_batch} kg (${r.inclusion_pct}%)`));
          pdfDoc.moveDown();
          pdfDoc.font("Courier-Bold").fontSize(10).text("KEY NUTRIENTS:");
          pdfDoc.font("Courier").fontSize(9);
          d.nutrients.forEach(n => pdfDoc.text(`  ${n.label}: ${n.value} ${n.unit}`));
          if (d.mixing_instructions) { pdfDoc.moveDown(); pdfDoc.font("Courier").fontSize(9).text(`Instructions: ${d.mixing_instructions}`); }
          pdfDoc.end();
        });

        const filename = `release-${Date.now()}.pdf`;
        fs.writeFileSync(path.join(reportsDir, filename), Buffer.concat(pdfChunks));
        mediaUrl = `${feedbotPublicBase}/reports/${filename}`;
      }
    } catch (pdfErr) {
      console.warn("[release/whatsapp] PDF attachment skipped:", pdfErr.message);
    }

    // Send via Twilio REST
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const msgData = new URLSearchParams({
      From: fromNum,
      To:   toNum.startsWith("whatsapp:") ? toNum : `whatsapp:${toNum}`,
      Body: msg,
    });
    if (mediaUrl) msgData.append("MediaUrl", mediaUrl);

    const twilioRes = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: msgData.toString(),
    });

    const twilioJson = await twilioRes.json();

    if (twilioRes.ok) {
      res.json({ ok: true, message_sid: twilioJson.sid, whatsapp_to: toNum, formula: d.formula_name });
    } else {
      res.status(502).json({ ok: false, error: twilioJson.message || "Twilio send failed", details: twilioJson });
    }

  } catch (err) {
    console.error("[release/whatsapp]", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
