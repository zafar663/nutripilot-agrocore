import { resolveAlias } from "../core/aliases/resolveAlias.mjs";

const samples = [
  "Maize",
  "Corn grain",
  "SBM 48",
  "Soybean meal (48%)",
  "DL Met",
  "NaHCO3",
  "Limestone grit",
  "Wheat bran" // should remain unknown unless you explicitly add it
];

for (const s of samples) {
  const r = resolveAlias(s, { locale: "US" });
  console.log(`${s.padEnd(18)} -> ${r.canonical_key ?? "UNKNOWN"} (${r.method})`);
}
