"use strict";

/** Gate-level USD / kg, Oct 2026. Synthetics stay well above grains. */
const BOOK = [
  [/tryptophan|\bl-?\s*trp\b/i, 9.92],
  [/phenylalanine/i, 8.82],
  [/histidine/i, 8.0],
  [/inositol/i, 18.0],
  [/chromium/i, 40.0],
  [/molybdate|molybdenum/i, 35.0],
  [/arginine/i, 6.0],
  [/isoleucine/i, 5.0],
  [/leucine/i, 4.0],
  [/valine/i, 2.76],
  [/mepron|mha|methionine hydroxy|dl-?\s*methionine|dl-?\s*met\b/i, 3.2],
  [/lysine sulphate|lysine sulfate|lysine so4|lysine sul/i, 1.43],
  [/lysine/i, 1.76],
  [/threonine/i, 1.65],
  [/phytase|protease|amylase|xylanase|\bnsp\b|enzyme/i, 8.5],
  [/choline/i, 1.2],
  [/premix|vitamin|kamix|nutri balance/i, 3.5],
  [/\bagps?\b|antibiotic growth/i, 4.5],
  [/coccid|anti-coccid/i, 5.0],
  [/acidifier|bufferment/i, 2.2],
  [/toxin/i, 3.0],
  [/soybean oil|poultry oil|palm oil|\boil\b/i, 1.39],
  [/by.?pass fat|tallow|fat 84|fat 99/i, 1.8],
  [/fish.{0,20}62/i, 1.85],
  [/fish/i, 1.5],
  [/poultry.{0,20}by-product|\bpbm\b/i, 0.68],
  [/meat.{0,10}bone|\bmbm\b/i, 0.55],
  [/blood/i, 0.85],
  [/feather/i, 0.48],
  [/albumin/i, 4.5],
  [/algae|spirulina/i, 8.0],
  [/animal protein concentrate 65|\bapc 65/i, 0.95],
  [/animal protein concentrate|\bapc\b/i, 0.82],
  [/soybean.{0,20}48/i, 0.45],
  [/soybean.{0,20}46/i, 0.42],
  [/soybean.{0,20}44/i, 0.38],
  [/soybean meal|soybean, meal|full-fat|soyabean/i, 0.42],
  [/gluten meal|gluten 60|\bcgm\b/i, 0.52],
  [/gluten feed|gluten 30|\bcgf\b/i, 0.2],
  [/ddgs/i, 0.28],
  [/canola/i, 0.32],
  [/sunflower/i, 0.28],
  [/cotton/i, 0.3],
  [/rapeseed|rape seed/i, 0.3],
  [/palm kernel/i, 0.22],
  [/guar/i, 0.4],
  [/wheat bran/i, 0.18],
  [/rice bran|rice polish/i, 0.2],
  [/rice husk/i, 0.08],
  [/rice broken|broken rice|\brice\b/i, 0.24],
  [/wheat/i, 0.24],
  [/sorghum|millet|barley|\boat/i, 0.21],
  [/corn 14|maize 14/i, 0.24],
  [/corn 13|maize 13/i, 0.22],
  [/corn 12|maize 12/i, 0.2],
  [/corn|maize/i, 0.22],
  [/algaroba/i, 0.15],
  [/bakery/i, 0.22],
  [/chips|date palm|gatawa|pea seed|\bpeas\b/i, 0.25],
  [/molasses/i, 0.16],
  [/monocalcium|\bmcp\b/i, 0.7],
  [/dicalcium|\bdcp\b/i, 0.66],
  [/limestone|calcium carbonate|\blime\b/i, 0.09],
  [/sodium bicarbonate|bicarb/i, 0.45],
  [/potassium chloride/i, 0.55],
  [/magnesium oxide/i, 0.48],
  [/magnesium sulfate|magnesium sulphate/i, 0.32],
  [/salt|nacl|sodium chloride/i, 0.1],

  // Trace minerals
  [/zinc oxide|zno\b/i, 2.5],
  [/zinc sulfate|zinc sulphate/i, 0.65],
  [/zinc/i, 1.2],
  [/copper sulfate|copper sulphate/i, 1.2],
  [/copper/i, 1.5],
  [/ferrous sulfate|ferrous sulphate|iron sulfate/i, 0.35],
  [/cobalt carbonate|cobalt/i, 8.0],
  [/potassium iodide/i, 25.0],
  [/sodium selenite|selenium/i, 18.0],
  [/manganese oxide|manganese/i, 1.2],
  [/sodium sulfate|sodium sulphate/i, 0.12],
  [/potassium carbonate/i, 0.65],
  [/calcium chloride/i, 0.18],

  // Forages & roughages
  [/alfalfa/i, 0.22],
  [/timothy|bermuda|bermudagrass|orchardgrass|orchard grass|brome|ryegrass|fescue|clover/i, 0.18],
  [/silage|haylage/i, 0.10],
  [/grass hay|native grass|meadow hay|range hay|prairie hay|browse|pasture/i, 0.15],
  [/hay\b/i, 0.17],

  // Specialty protein
  [/rumen.protected methionine/i, 6.5],
  [/urea/i, 0.55],
  [/soybean.*protein.*isolate|soy.*protein.*isolate/i, 2.8],
  [/soybean.*protein.*concentrate|soy.*protein.*conc/i, 1.8],
  [/soybean.*hull|soy.*hull/i, 0.18],
  [/soybean.*semi.defatted|soy.*semi.defatted/i, 0.55],
  [/soybean.*full.fat|soy.*full.fat|full.fat.*soy/i, 0.48],
  [/peanut|groundnut/i, 0.35],
  [/cassava|tapioca/i, 0.24],
  [/copra|coconut.*meal/i, 0.28],
  [/casein/i, 8.0],
  [/flaxseed|linseed/i, 0.55],

  // By-products & residues
  [/beet pulp|sugar beet/i, 0.28],
  [/citrus pulp/i, 0.22],
  [/brewer.*grain|brewers.*grain|distillers.*wet/i, 0.12],
  [/brewer.*yeast|yeast.*culture/i, 1.8],
  [/hominy/i, 0.22],
  [/soybean hull|soy hull/i, 0.18],
  [/triticale|rye\b/i, 0.22],
  [/sweet potato/i, 0.45],
  [/starch\b/i, 0.45],
  [/glucose|sucrose|lactose|sugar\b/i, 0.55],
  [/pasta|bread.*by/i, 0.20],

  // Fats & oils
  [/lard|pork fat/i, 1.0],
  [/poultry.*fat/i, 0.95],
  [/lecithin/i, 1.5],

  // Dairy & milk products
  [/skim.*milk|milk.*skimmed/i, 3.5],
  [/whole.*milk.*powder/i, 4.0],
  [/whey.*powder|milk.*whey/i, 0.85],
  [/whey.*permeate/i, 0.45],

  // Feed additives & supplements
  [/antioxidant|bha|bht/i, 4.0],
  [/betaine/i, 2.8],
  [/probiotic|prebiotic|synbiotic/i, 12.0],
  [/phytogenic|phytogen/i, 8.0],
  [/mold inhibitor|preservative\b/i, 3.5],
  [/emulsifier/i, 4.0],
  [/pellet binder|bentonite/i, 0.35],
  [/mannanase|glucanase|cellulase/i, 8.5],
  [/beta.glucan/i, 8.5],
  [/folic acid|folate/i, 12.0],
  [/niacin|nicotinic/i, 3.5],
  [/electrolyte/i, 2.5],
  [/babassu/i, 0.28],
  [/castor/i, 0.25],
  [/shrimp.*by.product|shrimp.*meal/i, 1.2],
  [/ouricuri|syagrus/i, 0.25],

  [/new ingredient/i, 0.4]
];

function bookPrice(name) {
  const n = String(name || "");
  for (const [re, px] of BOOK) {
    if (re.test(n)) return px;
  }
  return 0.35;
}

function isSpecialty(name) {
  return /inositol|chromium|molybdate|selenium|iodine|vitamin/i.test(String(name || ""));
}

function isSaneUsdPerKg(price, name) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return false;
  return p <= (isSpecialty(name) ? 80 : 25);
}

function basisToKgFactor(basis) {
  switch (String(basis || "per_kg").toLowerCase()) {
    case "per_metric_ton":
    case "mt":
    case "per_mt":
    case "per_tonne":
    case "tonne":
      return 1000;
    case "per_lb":
    case "lb":
      return 0.45359237;
    case "per_ton":
    case "ton":
    case "short_ton":
      return 907.18474;
    case "bag_40kg":
    case "per_bag_40kg":
      return 40;
    case "bag_50kg":
    case "per_bag":
    case "per_bag_50kg":
      return 50;
    default:
      return 1;
  }
}

function toUsdPerKg(price, basis) {
  const p = Number(price);
  if (!Number.isFinite(p)) return NaN;
  const f = basisToKgFactor(basis);
  return f ? p / f : p;
}

function fromUsdPerKg(perKg, basis) {
  const f = basisToKgFactor(basis);
  return Number(perKg) * (f || 1);
}

function applyUsdKgPrices(rows, { replaceInsane = true, targetBasis } = {}) {
  let changed = 0;
  const out = (rows || []).map((row) => {
    const name = row?.ingredient_name || row?.profile_id || "";
    const next = { ...row };
    const perKg = toUsdPerKg(next.price, next.price_basis || "per_kg");
    const ok = isSaneUsdPerKg(perKg, name);
    if (ok) return next;
    const hasPrice = Number.isFinite(Number(next.price)) && Number(next.price) > 0;
    if (hasPrice && !replaceInsane) return next;
    const fillBasis = String(next.price_basis || targetBasis || "per_kg");
    next.price = fromUsdPerKg(bookPrice(name), fillBasis);
    next.currency = next.currency || "USD";
    next.price_basis = fillBasis;
    next.price_manual = true;
    changed += 1;
    return next;
  });
  return { rows: out, changed };
}

module.exports = { bookPrice, applyUsdKgPrices, isSaneUsdPerKg, toUsdPerKg, fromUsdPerKg };
