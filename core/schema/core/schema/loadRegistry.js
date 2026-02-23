import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const registryPath = path.join(__dirname, "master_nutrient_registry.v1.json");

export function loadNutrientRegistry() {
  const raw = fs.readFileSync(registryPath, "utf-8");
  return JSON.parse(raw);
}
