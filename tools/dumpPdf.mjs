import fs from "fs";
import pdfParse from "pdf-parse";

const pdfPath =
  process.env.PDF_PATH ||
  (process.env.USERPROFILE + "\\Desktop\\Broiler STR-13-Dec-2025.pdf");

const buf = fs.readFileSync(pdfPath);
const pdf = await pdfParse(buf);
const text = pdf?.text || "";

console.log("PDF_PATH:", pdfPath);
console.log("TEXT_LEN:", text.length);

const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

const kw = /(maize|corn|soy|soya|sbm|fish|oil|bajra|millet|acid|dlm|meth|lys|premix|choline|cocc|binder|phytase|protease|nsp|agp|salt)/i;

console.log("\n--- KEYWORD LINES (first 80) ---");
let shown = 0;
for (const l of lines) {
  if (kw.test(l)) {
    console.log(l);
    shown++;
    if (shown >= 80) break;
  }
}

console.log("\n--- TWO-NUMBER ROWS (first 50) ---");
let count = 0;
for (const l of lines) {
  if (/^(.+?)\s+(\d{1,3}\.\d{1,4})\s+(\d{1,6}\.\d{1,4})$/.test(l)) {
    console.log(l);
    count++;
    if (count >= 50) break;
  }
}
