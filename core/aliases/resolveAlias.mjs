import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALIAS_RULES } from "./alias.rules.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[%]/g, " % ")
    .replace(/\s+/g, " ")
    .trim();
}

let _cache = null;

export function loadAliasDb() {
  if (_cache) return _cache;
  const dbPath = path.join(__dirname, "alias.db.json");
  const raw = fs.readFileSync(dbPath, "utf8").replace(/^\uFEFF/, "");
  const db = JSON.parse(raw);

  // Build reverse lookup map: alias -> canonical key
  const map = new Map();
  for (const [key, arr] of Object.entries(db.aliases || {})) {
    for (const a of arr) {
      const na = norm(a);
      if (!na) continue;
      // Do not overwrite existing mapping (first wins) to keep deterministic
      if (!map.has(na)) map.set(na, key);
    }
  }

  _cache = { db, map };
  return _cache;
}

/**
 * Resolve a raw ingredient name to a canonical key.
 * Conservative by design:
 * - exact alias match
 * - regex rules (high confidence only)
 * - otherwise returns unknown
 */
export function resolveAlias(rawName, { locale = "US" } = {}) {
  const raw = String(rawName ?? "");
  const cleaned = norm(raw);

  const { map } = loadAliasDb();

  // 1) exact alias match
  if (map.has(cleaned)) {
    return {
      raw_name: raw,
      cleaned_name: cleaned,
      canonical_key: map.get(cleaned),
      method: "exact",
      locale,
      unknown: false
    };
  }

  // 2) conservative regex rules
  for (const rule of ALIAS_RULES) {
    if (rule.re.test(raw) || rule.re.test(cleaned)) {
      return {
        raw_name: raw,
        cleaned_name: cleaned,
        canonical_key: rule.key,
        method: "rule",
        locale,
        unknown: false
      };
    }
  }

  // 3) unknown fallback (never guess)
  return {
    raw_name: raw,
    cleaned_name: cleaned,
    canonical_key: null,
    method: "unknown",
    locale,
    unknown: true
  };
}
