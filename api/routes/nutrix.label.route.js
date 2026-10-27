// api/routes/nutrix.label.route.js
import express from "express";
import PDFDocument from "pdfkit";

const router = express.Router();
const ROUTE_VERSION = "nutrix_label_v3_2026_05_11";

// ── Helpers ──────────────────────────────────────────────────────────────────

function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function round(v, d = 3) { const n = Number(v); if (!Number.isFinite(n)) return null; return Number(n.toFixed(d)); }

function normalizeFormulaRows(rows = []) {
  return rows
    .map(r => ({ ingredient_id: r.ingredient_id || r.id || null, ingredient_name: r.ingredient_name || r.name || "Unknown", inclusion: num(r.inclusion ?? r.percent ?? r.value, 0) }))
    .filter(r => r.inclusion > 0)
    .sort((a, b) => b.inclusion - a.inclusion);
}

function buildIngredientStatement(rows) { return rows.map(r => r.ingredient_name).join(", "); }

function pickGuaranteedAnalysis(nutrients = {}) {
  const map = [
    { key: "cp",         label: "Crude Protein",         unit: "%",       decimals: 2 },
    { key: "ee",         label: "Crude Fat",              unit: "%",       decimals: 2 },
    { key: "crude_fat",  label: "Crude Fat",              unit: "%",       decimals: 2 },
    { key: "cf",         label: "Crude Fiber",            unit: "%",       decimals: 2 },
    { key: "crude_fiber",label: "Crude Fiber",            unit: "%",       decimals: 2 },
    { key: "ash",        label: "Ash",                    unit: "%",       decimals: 2 },
    { key: "ca",         label: "Calcium",                unit: "%",       decimals: 2 },
    { key: "total_p",    label: "Total Phosphorus",       unit: "%",       decimals: 2 },
    { key: "avp",        label: "Available Phosphorus",   unit: "%",       decimals: 2 },
    { key: "na",         label: "Sodium",                 unit: "%",       decimals: 2 },
    { key: "salt",       label: "Salt",                   unit: "%",       decimals: 2 },
    { key: "moisture",   label: "Moisture",               unit: "%",       decimals: 2 },
    { key: "me_kcal_kg", label: "Metabolizable Energy",  unit: "kcal/kg", decimals: 0 },
    { key: "me",         label: "Metabolizable Energy",  unit: "kcal/kg", decimals: 0 },
  ];
  const used = new Set();
  return map
    .filter(m => nutrients[m.key] != null && !used.has(m.label))
    .map(m => { used.add(m.label); return { key: m.key, label: m.label, value: round(nutrients[m.key], m.decimals), unit: m.unit, declaration: `${m.label}: ${round(nutrients[m.key], m.decimals)} ${m.unit}` }; });
}

// ── JSON label endpoint ───────────────────────────────────────────────────────

router.post("/label", async (req, res) => {
  try {
    const body = req.body || {};
    const productName = body.product_name || body.formula_name || "Untitled Feed";
    const formulaRows = normalizeFormulaRows(body.formula_rows || body.ingredients || body.formula || []);
    const nutrients = body.nutrient_profile || body.calculated_nutrients || body.nutrients || {};
    const guaranteedAnalysis = pickGuaranteedAnalysis(nutrients);

    const label = {
      label_type: "standard_feed_label_v1",
      product_name: productName,
      context: { species: body.species || null, type: body.type || null, production: body.production || null, breed: body.breed || null, phase: body.phase || null },
      ingredient_list: { rule: "descending_inclusion_percentage", rows: formulaRows, statement: buildIngredientStatement(formulaRows) },
      guaranteed_analysis: guaranteedAnalysis,
      printable_sections: [
        { section: "product_name", title: productName },
        { section: "ingredient_statement", title: "Ingredients", text: buildIngredientStatement(formulaRows) },
        { section: "guaranteed_analysis", title: "Guaranteed Analysis", rows: guaranteedAnalysis },
      ],
      metadata: { route_version: ROUTE_VERSION, generated_at: new Date().toISOString(), commercial_label: true },
    };

    return res.json({ ok: true, route_version: ROUTE_VERSION, label });
  } catch (err) {
    return res.status(500).json({ ok: false, route_version: ROUTE_VERSION, error: err.message || String(err) });
  }
});

// ── PDF label endpoint ────────────────────────────────────────────────────────

router.post("/label/pdf", async (req, res) => {
  try {
    const body = req.body || {};
    const cfg  = body.config || {};

    const productName   = body.product_name  || body.formula_name || "Untitled Feed";
    const species       = body.species       || "";
    const type          = body.type          || "";
    const phase         = body.phase         || "";
    const standard      = cfg.standard       || "AAFCO";

    // Wording fields
    const productDescription = cfg.showProductDescription !== false ? (cfg.productDescription || "") : "";
    const disclaimer         = cfg.showDisclaimer !== false         ? (cfg.disclaimer         || "") : "";
    const feedingDirections  = cfg.showFeedingDirections !== false  ? (cfg.feedingDirections  || "") : "";
    const storageInstr       = cfg.showStorageInstructions !== false? (cfg.storageInstructions|| "") : "";
    const warningText        = cfg.warningText        || "";
    const legalFooter        = cfg.showLegalFooter !== false ? (cfg.legalFooter || "") : "";

    // Product details
    const netWeight     = cfg.netWeight     || "";
    const batchNumber   = cfg.batchNumber   || "";
    const lotNumber     = cfg.lotNumber     || "";
    const bestBefore    = cfg.bestBefore    || "";
    const regNumber     = cfg.registrationNumber || "";
    const mfgName       = cfg.manufacturerName    || "";
    const mfgAddr       = cfg.manufacturerAddress || "";
    const distName      = cfg.distributorName     || "";
    const distAddr      = cfg.distributorAddress  || "";

    const formulaRows         = normalizeFormulaRows(body.formula_rows || body.ingredients || []);
    const nutrients           = body.nutrient_profile || body.calculated_nutrients || body.nutrients || {};
    const ga                  = pickGuaranteedAnalysis(nutrients);
    const ingredientStatement = buildIngredientStatement(formulaRows);
    const contextLine         = [species, type, phase].filter(Boolean).join(" · ").toUpperCase();

    // ── Build PDF ─────────────────────────────────────────────────────────

    const doc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 40, left: 45, right: 45 } });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => {
      const pdf = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${productName.replace(/[^a-z0-9]/gi, "_")}.pdf"`);
      res.send(pdf);
    });

    // Palette & layout
    const DARK  = "#1a1f2e";
    const GOLD  = "#d4a843";
    const CREAM = "#f8f6f0";
    const MUTED = "#7a6f58";
    const L     = 45;
    const W     = doc.page.width - 90;
    const MID   = L + W / 2 + 6;
    const CW    = W / 2 - 6;

    // Helper to draw a section head
    function sHead(x, y, label, w) {
      doc.font("Courier-Bold").fontSize(7).fillColor(MUTED).characterSpacing(1.4).text(label, x, y, { width: w });
      doc.characterSpacing(0);
      const ly = y + 11;
      doc.moveTo(x, ly).lineTo(x + w, ly).lineWidth(0.4).strokeColor("#e0dbd0").stroke();
      return ly + 5;
    }

    // Helper to add a text block and return new Y
    function textBlock(x, y, text, w, opts = {}) {
      doc.font(opts.bold ? "Times-Bold" : "Times-Roman")
         .fontSize(opts.size || 9.5)
         .fillColor(opts.color || "#2a2010")
         .text(text, x, y, { width: w, lineGap: 2 });
      return doc.y + (opts.gap || 10);
    }

    // ── HEADER ────────────────────────────────────────────────────────────
    doc.rect(L - 5, 40, W + 10, productDescription ? 80 : 64).fill(DARK);

    // Standard badge
    doc.roundedRect(L + W - 50, 47, 50, 16, 2).fill(GOLD);
    doc.font("Courier-Bold").fontSize(7).fillColor(DARK).characterSpacing(1).text(standard, L + W - 46, 51, { width: 42, align: "center" });
    doc.characterSpacing(0);

    // Product name
    doc.font("Times-Bold").fontSize(20).fillColor(CREAM).text(productName, L + 4, 50, { width: W - 60 });

    // Context line
    if (contextLine) {
      doc.font("Courier").fontSize(8).fillColor("#8892a4").text(contextLine, L + 4, 75, { width: W - 60 });
    }

    // Product description in header
    if (productDescription) {
      doc.font("Times-Italic").fontSize(9).fillColor("#c8c0a8").text(productDescription, L + 4, 84, { width: W - 10 });
    }

    const headerBottom = productDescription ? 122 : 106;

    // Gold rule
    doc.rect(L - 5, headerBottom, W + 10, 3).fill(GOLD);

    // ── TWO-COLUMN BODY ───────────────────────────────────────────────────
    let lY = headerBottom + 12;
    let rY = headerBottom + 12;

    // LEFT: Guaranteed Analysis
    if (cfg.showGuaranteedAnalysis !== false && ga.length > 0) {
      lY = sHead(L, lY, "GUARANTEED ANALYSIS", CW);
      ga.forEach(g => {
        doc.font("Times-Roman").fontSize(10).fillColor("#2a2010").text(g.label, L, lY, { width: CW - 72 });
        doc.font("Courier-Bold").fontSize(9).fillColor(DARK).text(`${g.value} ${g.unit}`, L + CW - 70, lY, { width: 70, align: "right" });
        doc.moveTo(L, lY + 13).lineTo(L + CW, lY + 13).lineWidth(0.25).strokeColor("#ece8e0").stroke();
        lY += 16;
      });
      lY += 6;
    }

    // LEFT: Net Weight / Batch / Lot / Best Before / Reg No
    const metaItems = [];
    if (netWeight)   metaItems.push({ k: "Net Weight",   v: netWeight });
    if (batchNumber) metaItems.push({ k: "Batch No.",    v: batchNumber });
    if (lotNumber)   metaItems.push({ k: "Lot No.",      v: lotNumber });
    if (bestBefore)  metaItems.push({ k: "Best Before",  v: bestBefore });
    if (regNumber)   metaItems.push({ k: "Reg. No.",     v: regNumber });

    if (metaItems.length > 0 && cfg.showNetWeight !== false) {
      doc.moveTo(L, lY).lineTo(L + CW, lY).lineWidth(0.5).strokeColor("#e0dbd0").stroke();
      lY += 8;
      metaItems.forEach(m => {
        doc.font("Courier").fontSize(8.5).fillColor(MUTED).text(m.k.toUpperCase(), L, lY, { width: CW - 62 });
        doc.font("Courier-Bold").fontSize(9).fillColor(DARK).text(m.v, L + CW - 60, lY, { width: 60, align: "right" });
        lY += 14;
      });
      lY += 4;
    }

    // LEFT: Storage
    if (storageInstr) {
      lY = sHead(L, lY, "STORAGE INSTRUCTIONS", CW);
      lY = textBlock(L, lY, storageInstr, CW);
    }

    // RIGHT: Ingredients
    if (cfg.showIngredients !== false && ingredientStatement) {
      rY = sHead(MID, rY, "INGREDIENTS", CW);
      rY = textBlock(MID, rY, ingredientStatement, CW);
    }

    // RIGHT: Disclaimer
    if (disclaimer) {
      rY = sHead(MID, rY, "REGULATORY STATEMENT", CW);
      doc.font("Times-Italic").fontSize(9).fillColor("#4a4f3a").text(disclaimer, MID, rY, { width: CW, lineGap: 2 });
      rY = doc.y + 10;
    }

    // RIGHT: Feeding Directions
    if (feedingDirections) {
      rY = sHead(MID, rY, "FEEDING DIRECTIONS", CW);
      rY = textBlock(MID, rY, feedingDirections, CW);
    }

    // RIGHT: Manufacturer
    if (mfgName || mfgAddr) {
      rY = sHead(MID, rY, "MANUFACTURED BY", CW);
      if (mfgName) { doc.font("Times-Bold").fontSize(10).fillColor(DARK).text(mfgName, MID, rY, { width: CW }); rY = doc.y + 3; }
      if (mfgAddr) { doc.font("Times-Roman").fontSize(9).fillColor("#5a4f3a").text(mfgAddr, MID, rY, { width: CW }); rY = doc.y + 3; }
      rY += 8;
    }

    // RIGHT: Distributor
    if (distName || distAddr) {
      rY = sHead(MID, rY, "DISTRIBUTED BY", CW);
      if (distName) { doc.font("Times-Bold").fontSize(10).fillColor(DARK).text(distName, MID, rY, { width: CW }); rY = doc.y + 3; }
      if (distAddr) { doc.font("Times-Roman").fontSize(9).fillColor("#5a4f3a").text(distAddr, MID, rY, { width: CW }); rY = doc.y + 3; }
      rY += 8;
    }

    // ── WARNING BAR ───────────────────────────────────────────────────────
    const bottomY = Math.max(lY, rY) + 8;
    if (warningText) {
      doc.rect(L - 5, bottomY, W + 10, 24).fill("#fff8e8");
      doc.rect(L - 5, bottomY, W + 10, 24).lineWidth(0.8).strokeColor(GOLD).stroke();
      doc.font("Courier").fontSize(8.5).fillColor("#7a5a10").text(`⚠  ${warningText}`, L + 4, bottomY + 7, { width: W - 8 });
    }

    // ── LEGAL FOOTER ──────────────────────────────────────────────────────
    const legalY = warningText ? bottomY + 30 : bottomY;
    if (legalFooter) {
      doc.rect(L - 5, legalY, W + 10, 20).fill("#f8f6f0");
      doc.moveTo(L - 5, legalY).lineTo(L + W + 5, legalY).lineWidth(0.5).strokeColor("#d0c8b8").stroke();
      doc.font("Courier").fontSize(8).fillColor("#7a6f58").text(legalFooter, L + 4, legalY + 5, { width: W - 8, align: "center" });
    }

    // ── FOOTER STAMP ──────────────────────────────────────────────────────
    const footerY = doc.page.height - 40;
    doc.moveTo(L - 5, footerY).lineTo(L + W + 5, footerY).lineWidth(0.4).strokeColor("#d0c8b8").stroke();
    doc.font("Courier").fontSize(7.5).fillColor("#c0b8a8")
      .text(`Generated by AgroCore Prime · ${new Date().toLocaleDateString()} · ${ROUTE_VERSION}`, L, footerY + 6, { width: W, align: "center" });

    doc.end();

  } catch (err) {
    console.error("[label/pdf] error:", err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

export default router;
