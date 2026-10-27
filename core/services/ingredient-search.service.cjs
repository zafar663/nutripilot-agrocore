const fs = require("fs");
const path = require("path");

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function normalize(x) {
  return String(x || "")
    .toLowerCase()
    .trim()
    .replace(/[_\-(),.%]+/g, " ")
    .replace(/\s+/g, " ");
}

function score(query, text) {
  const q = normalize(query);
  const t = normalize(text);

  if (!q || !t) return 0;

  if (t === q) return 120;
  if (t.startsWith(q)) return 100;
  if (t.includes(q)) return 80;

  const words = t.split(" ").filter(Boolean);
  let best = 0;

  for (const w of words) {
    if (w === q) best = Math.max(best, 95);
    else if (w.startsWith(q)) best = Math.max(best, 85);
    else if (w.includes(q)) best = Math.max(best, 70);
  }

  return best;
}

function loadIngredientDB() {
  const file = path.resolve(
    process.cwd(),
    "core/db/ingredients/poultry/us/v1/ingredients.poultry.us.sid.v1.json"
  );

  const j = readJson(file);
  if (!j) return [];

  const db = j.db || {};
  const aliases = j.aliases || {};

  const aliasMap = {};
  for (const [alias, id] of Object.entries(aliases)) {
    if (!aliasMap[id]) aliasMap[id] = [];
    aliasMap[id].push(alias);
  }

  const list = [];
  for (const [id, row] of Object.entries(db)) {
    list.push({
      id,
      display_name: row.display_name || id,
      aliases: aliasMap[id] || []
    });
  }

  return list;
}

function hasAny(text, arr) {
  const t = normalize(text);
  return arr.some(x => t.includes(normalize(x)));
}

function injectSyntheticAliases(master) {
  const extraAliases = {
    soybean_meal_44_5_cp: ["soy", "soy meal", "sbm", "sbm 44", "soybean meal", "soybean meal 44"],
    soybean_meal_45_6_cp_avg: ["soy", "soy meal", "sbm", "sbm 46", "sbm 45", "soybean meal", "soybean meal 46"],
    soybean_meal_46_5_cp: ["soy", "soy meal", "sbm", "sbm 46", "soybean meal", "soybean meal 46"],
    soybean_meal_48_cp: ["soy", "soy meal", "sbm", "sbm 48", "soybean meal", "soybean meal 48"],
    corn_grain_avg: ["corn", "maize", "corn grain", "maize grain"],
    rice_broken: ["rice", "broken rice", "rice broken"],
    rice_bran: ["rice bran"],
    blood_meal: ["blood", "blood meal"]
  };

  return master.map(item => {
    const extras = extraAliases[item.id] || [];
    return {
      ...item,
      aliases: [...new Set([...(item.aliases || []), ...extras])]
    };
  });
}

function relevanceBoost(query, item) {
  const q = normalize(query);
  const id = normalize(item.id);
  const name = normalize(item.display_name);
  const aliases = (item.aliases || []).map(normalize);
  const all = [id, name, ...aliases].join(" ");

  let boost = 0;

  if (["corn", "maize"].includes(q)) {
    if (id.includes("corn_grain_avg") || all.includes("corn grain average")) boost += 110;
    if (all.includes("corn grain")) boost += 35;
    if (hasAny(all, ["ddgs", "hp ddg", "gluten", "bran with solubles", "germ"])) boost -= 25;
  }

  if (q === "rice") {
    if (id.includes("rice_broken")) boost += 110;
    if (id.includes("rice_bran")) boost += 70;
    if (all.includes("defatted bran")) boost += 20;
  }

  if (["soy", "soybean", "soy meal"].includes(q)) {
    if (hasAny(all, ["soybean meal", " meal 44", " meal 45", " meal 46", " meal 48"])) boost += 90;
    if (hasAny(all, ["oil", "acid oil", "degummed oil", "hulls"])) boost -= 25;
  }

  if (["sbm", "sbm 44", "sbm 45", "sbm 46", "sbm 48"].includes(q)) {
    if (hasAny(all, ["soybean meal", " meal 44", " meal 45", " meal 46", " meal 48", "sbm"])) boost += 140;
    if (!hasAny(all, ["soybean", "meal"])) boost -= 50;
  }

  if (q === "blood" || q === "blood meal") {
    if (id.includes("blood_meal")) boost += 100;
    if (all.includes("plasma") || all.includes("red cells")) boost += 20;
  }

  return boost;
}

function searchIngredients(query, limit = 8) {
  let ingredients = loadIngredientDB();
  ingredients = injectSyntheticAliases(ingredients);

  const results = ingredients
    .map(i => {
      let s = 0;

      s = Math.max(s, score(query, i.id));
      s = Math.max(s, score(query, i.display_name));

      for (const a of i.aliases) {
        s = Math.max(s, score(query, a));
      }

      s += relevanceBoost(query, i);

      return {
        id: i.id,
        display_name: i.display_name,
        score: s
      };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.display_name.localeCompare(b.display_name))
    .slice(0, limit);

  return results;
}

module.exports = {
  searchIngredients
};
