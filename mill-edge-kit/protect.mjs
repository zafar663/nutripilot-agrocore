/**
 * Build the copies that Mill IQ puts in a download.
 * Readable index.js stays in this folder for us.
 * dist/index.js is what a mill PC receives.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JavaScriptObfuscator from "javascript-obfuscator";

const dir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(dir, "dist");
fs.mkdirSync(outDir, { recursive: true });

const reserved = [];

for (const name of ["index.js"]) {
  const src = fs.readFileSync(path.join(dir, name), "utf8");
  const out = JavaScriptObfuscator.obfuscate(src, {
    compact: true,
    target: "node",
    renameGlobals: false,
    reservedNames: reserved,
    transformObjectKeys: true,
    stringArray: true,
    stringArrayThreshold: 1,
    stringArrayEncoding: ["rc4"],
    stringArrayWrappersCount: 2,
    stringArrayWrappersType: "function",
    splitStrings: true,
    splitStringsChunkLength: 8,
    unicodeEscapeSequence: false,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    selfDefending: false,
    simplify: true,
  }).getObfuscatedCode();
  fs.writeFileSync(path.join(outDir, name), out);
  console.log("wrote", name, out.length);
}
