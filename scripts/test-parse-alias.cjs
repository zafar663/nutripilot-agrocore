const { parseFormulaText } = require("../core/parser/parseFormulaText.cjs");

const r = parseFormulaText("Maize 50\nSBM 48 30\nLimestone grit 2\nWheat bran 5");
console.log(r.items);
console.log("unknown_raw:", r.unknown_raw);
