import { createRequire } from "module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

const root = process.cwd(); // safest for your workflow
console.log("CWD:", process.cwd());
console.log("ROOT:", root);

const ingredientsPath = path.join(root, "core", "db", "ingredients.poultry.v0.json");
const aliasPath = path.join(root, "core", "aliases", "alias.db.json");

console.log("ingredientsPath:", ingredientsPath);
console.log("aliasPath:", aliasPath);

console.log("ingredients exists:", fs.existsSync(ingredientsPath));
console.log("alias exists:", fs.existsSync(aliasPath));

const ingredientsDB = require(ingredientsPath);

const aliasRaw = fs.readFileSync(aliasPath, "utf8").replace(/^\uFEFF/, "");
const aliasDB = JSON.parse(aliasRaw);

console.log("has key sbm:", Object.prototype.hasOwnProperty.call(ingredientsDB, "sbm"));
console.log("has key limestone:", Object.prototype.hasOwnProperty.call(ingredientsDB, "limestone"));

const { resolveDbIngredientKey } = require(path.join(root, "core", "aliases", "resolveDbIngredientKey.cjs"));
console.log('resolveDbIngredientKey("soybean_meal") ->', resolveDbIngredientKey("soybean_meal", ingredientsDB));
console.log('resolveDbIngredientKey("limestone") ->', resolveDbIngredientKey("limestone", ingredientsDB));

const soyAliases = (aliasDB.aliases?.soybean_meal || []);
console.log("alias soybean_meal includes sbm:", soyAliases.map(s=>String(s).toLowerCase()).includes("sbm"));
