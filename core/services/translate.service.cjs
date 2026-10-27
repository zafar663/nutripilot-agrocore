"use strict";

/**
 * core/services/translate.service.cjs
 *
 * Shared free machine-translation helper (Google Translate, no API key)
 * used by feedbot-whatsapp, the Nutrix AI route, and the web ecosystem
 * (FarmPulse, VendorPulse, etc.) to support any country / language.
 */

let _mod = null;
async function getMod() {
  if (_mod) return _mod;
  const imported = await import("google-translate-api-x");
  _mod = imported?.default && typeof imported.default === "object"
    ? { ...imported, ...imported.default }
    : imported;
  if (typeof _mod.translate !== "function" && typeof imported.default === "function") {
    _mod.translate = imported.default;
  }
  return _mod;
}

// Resolve a user-supplied language (ISO code or English name like "Spanish") to an ISO code.
async function resolveLanguageCode(lang) {
  if (!lang) return null;
  const trimmed = String(lang).trim();
  if (!trimmed) return null;
  const mod = await getMod();
  const getCode = mod.getCode || mod.default?.getCode;
  if (typeof getCode === "function") return getCode(trimmed) || null;
  return /^[a-z]{2}(-[A-Z]{2})?$/i.test(trimmed) ? trimmed : null;
}

function languageName(code) {
  if (!code) return null;
  return _mod?.languages?.[code] || code;
}

// Resolve a bare English language name (e.g. "French", "Hindi") to its ISO code.
// Unlike resolveLanguageCode, this only matches full language names (not raw
// 2-letter codes), so a standalone word like "no" doesn't accidentally match
// the ISO code for Norwegian.
async function resolveLanguageByName(text) {
  const trimmed = String(text || "").trim().toLowerCase();
  if (!trimmed) return null;
  const mod = await getMod();
  for (const [code, name] of Object.entries(mod.languages || {})) {
    if (String(name).toLowerCase() === trimmed) return code;
  }
  return null;
}

// Make sure the translator module (and its language-name table) is loaded.
async function ensureLoaded() {
  await getMod();
}

// Cache repeated translations (e.g. menu prompts, confirmation messages,
// short menu replies) so identical text+language pairs aren't re-sent to the
// external translate API every time. Capped to avoid unbounded growth.
const _translateCache = new Map();
const TRANSLATE_CACHE_MAX = 2000;

// Translate text. source defaults to "auto" (auto-detect).
async function translateText(text, target, source = "auto") {
  const input = String(text ?? "");
  if (!input.trim() || !target || target === source) {
    return { text: input, from: source === "auto" ? "en" : source };
  }

  const cacheKey = `${source}:${target}:${input}`;
  const cached = _translateCache.get(cacheKey);
  if (cached) return cached;

  try {
    const mod = await getMod();
    const r = await mod.translate(input, { to: target, from: source });
    const result = { text: r.text, from: r.from?.language?.iso || source };
    if (_translateCache.size >= TRANSLATE_CACHE_MAX) _translateCache.clear();
    _translateCache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.error("[translate] failed:", e.message);
    return { text: input, from: source === "auto" ? "en" : source, error: e.message };
  }
}

// Translate an array of short strings in as few requests as possible.
// Used by the web frontend language widget to translate many DOM strings
// at once. Falls back to returning the original string for any item that
// fails to translate.
async function translateBatch(texts, target, source = "auto") {
  const arr = Array.isArray(texts) ? texts.map((t) => String(t ?? "")) : [String(texts ?? "")];
  if (!target || target === source || target === "en") return arr;

  const mod = await getMod();
  const CHUNK = 100;
  const out = [];

  for (let i = 0; i < arr.length; i += CHUNK) {
    const chunk = arr.slice(i, i + CHUNK);
    try {
      const r = await mod.translate(chunk, { to: target, from: source });
      const results = Array.isArray(r) ? r : [r];
      results.forEach((res, idx) => out.push(res?.text ?? chunk[idx]));
    } catch (e) {
      console.error("[translate] batch failed:", e.message);
      chunk.forEach((t) => out.push(t));
    }
  }

  return out;
}

// Detect the language of a piece of text.
async function detectLanguage(text) {
  const input = String(text ?? "").trim();
  if (!input) return "en";
  try {
    const mod = await getMod();
    const r = await mod.translate(input, { to: "en", from: "auto" });
    return r.from?.language?.iso || "en";
  } catch (e) {
    console.error("[translate] detect failed:", e.message);
    return "en";
  }
}

// Translate text but leave ```code blocks``` (WhatsApp monospace tables) untouched,
// since translating numeric/tabular data garbles formatting and units.
async function translatePreservingCodeBlocks(text, target, source = "auto") {
  const input = String(text ?? "");
  if (!input.trim() || !target || target === "en" || target === source) {
    return { text: input, from: source === "auto" ? "en" : source };
  }

  const parts = input.split(/(```[\s\S]*?```)/g);
  let detected = source;
  const out = [];

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("```") || !part.trim()) {
      out.push(part);
      continue;
    }
    const lead  = part.match(/^\s*/)[0];
    const trail = part.match(/\s*$/)[0];
    const body  = part.slice(lead.length, part.length - trail.length || undefined);
    const r = await translateText(body, target, source);
    if (r.from) detected = r.from;
    out.push(lead + r.text + trail);
  }

  return { text: out.join(""), from: detected };
}

// Map of international calling-code prefixes (no leading "+") to a default
// ISO language code for that country/region. Used to auto-detect a
// WhatsApp user's likely language from their phone number when they first
// message the bot. Longest-prefix match wins (e.g. "1809" before "1").
const PHONE_COUNTRY_LANG = {
  // Dominican Republic / Puerto Rico (NANP, Spanish)
  "1809": "es", "1829": "es", "1849": "es", "1787": "es", "1939": "es",
  "1": "en", // US/Canada/most Caribbean (NANP) default

  // Africa
  "20": "ar", "211": "en", "212": "ar", "213": "ar", "216": "ar", "218": "ar",
  "220": "en", "221": "fr", "222": "fr", "223": "fr", "224": "fr", "225": "fr",
  "226": "fr", "227": "fr", "228": "fr", "229": "fr", "230": "en", "231": "en",
  "232": "en", "233": "en", "234": "en", "235": "fr", "236": "fr", "237": "fr",
  "238": "pt", "239": "pt", "240": "es", "241": "fr", "242": "fr", "243": "fr",
  "244": "pt", "245": "pt", "246": "en", "248": "fr", "249": "ar", "250": "rw",
  "251": "am", "252": "so", "253": "fr", "254": "sw", "255": "sw", "256": "sw",
  "257": "fr", "258": "pt", "260": "en", "261": "mg", "262": "fr", "263": "en",
  "264": "en", "265": "en", "266": "en", "267": "en", "268": "en", "269": "fr",
  "27": "en", "291": "ti",

  // Europe
  "30": "el", "31": "nl", "32": "nl", "33": "fr", "34": "es",
  "351": "pt", "352": "fr", "353": "en", "354": "is", "355": "sq", "356": "mt",
  "357": "el", "358": "fi", "359": "bg", "36": "hu",
  "370": "lt", "371": "lv", "372": "et", "373": "ro", "374": "hy", "375": "be",
  "376": "ca", "377": "fr", "378": "it", "380": "uk", "381": "sr", "382": "sr",
  "383": "sq", "385": "hr", "386": "sl", "387": "bs", "389": "mk",
  "39": "it", "40": "ro", "41": "de", "420": "cs", "421": "sk", "423": "de",
  "43": "de", "44": "en", "45": "da", "46": "sv", "47": "no", "48": "pl", "49": "de",
  "7": "ru",

  // Latin America
  "500": "en", "501": "en", "502": "es", "503": "es", "504": "es", "505": "es",
  "506": "es", "507": "es", "509": "ht",
  "51": "es", "52": "es", "53": "es", "54": "es", "55": "pt", "56": "es",
  "57": "es", "58": "es", "591": "es", "593": "es", "595": "es", "598": "es",

  // Asia / Pacific
  "60": "ms", "61": "en", "62": "id", "63": "en", "64": "en", "65": "en", "66": "th",
  "670": "pt", "81": "ja", "82": "ko", "84": "vi", "86": "zh-CN",
  "880": "bn", "855": "km", "856": "lo",
  "90": "tr", "91": "hi", "92": "ur", "93": "fa", "94": "si", "95": "my", "98": "fa",

  // Middle East
  "961": "ar", "962": "ar", "963": "ar", "964": "ar", "965": "ar", "966": "ar",
  "967": "ar", "968": "ar", "970": "ar", "971": "ar", "972": "he", "973": "ar",
  "974": "ar", "975": "dz", "976": "mn", "977": "ne",
  "992": "tg", "993": "tk", "994": "az", "995": "ka", "996": "ky", "998": "uz",
};

// Detect a default language for a WhatsApp phone number (e.g. "whatsapp:+254712345678")
// based on its international dial-code prefix. Returns an ISO code or null if unknown.
function detectLanguageFromPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return null;
  for (let len = 4; len >= 1; len--) {
    const prefix = digits.slice(0, len);
    if (PHONE_COUNTRY_LANG[prefix]) return PHONE_COUNTRY_LANG[prefix];
  }
  return null;
}

module.exports = {
  translateText,
  translateBatch,
  detectLanguage,
  translatePreservingCodeBlocks,
  resolveLanguageCode,
  resolveLanguageByName,
  languageName,
  detectLanguageFromPhone,
  ensureLoaded
};
