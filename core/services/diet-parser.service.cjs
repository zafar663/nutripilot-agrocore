'use strict';

// ============================================================
// NutriPilot Diet Intent Parser
// parseDietRequest(text) → { species, type, breed, breed_label,
//   phase, phase_label, nutrix_key, confidence, fallback, summary }
// No external dependencies — pure CJS, Levenshtein fuzzy match.
// ============================================================

const { DIET_INTENT_DB, SPECIES_ALIASES } = require('../db/diet-intent/diet-intent.db.cjs');

// ─── Levenshtein distance ─────────────────────────────────
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array(n + 1).fill(0).map((__, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i-1][j-1];
      else dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

function normalizedDist(a, b) {
  const d = levenshtein(a, b);
  return d / Math.max(a.length, b.length, 1);
}

// ─── Text normalisation ───────────────────────────────────
const ABBREVIATIONS = {
  'w': 'week', 'wk': 'week', 'wks': 'weeks',
  'd': 'day',  'dy': 'day',
  'mo': 'month', 'mos': 'months', 'm': 'month',
  'ps': 'parent stock', 'gp': 'grandparent', 'ggp': 'great grandparent',
  'dim': 'days in milk',
  'kg': 'kg', 'g': 'g', 'lb': 'lb', 'lbs': 'lb',
  'hf': 'holstein friesian',
  'lw': 'large white', 'yw': 'yorkshire',
  'nz': 'new zealand',
};

function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[_\-]/g, ' ')   // dashes/underscores → space
    .replace(/[؀-ۿ]+/g, s => s) // keep Arabic as-is
    .replace(/[^\w\s؀-ۿ]/g, ' ') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

function expandAbbreviations(text) {
  return text.split(' ').map(token => ABBREVIATIONS[token] || token).join(' ');
}

function prepareText(raw) {
  return expandAbbreviations(normalise(raw));
}

// ─── Day/week/month extraction ────────────────────────────
// Returns { days, isDIM } or null. Run on ORIGINAL text.
function extractAgeDays(rawText) {
  const t = rawText.toLowerCase();
  // "dim 100" / "100 dim" — days in milk (lactation context)
  let m = t.match(/\bdim\s*(\d+)\b/) || t.match(/\b(\d+)\s*dim\b/);
  if (m) return { days: parseInt(m[1], 10), isDIM: true };
  // "days in milk 150"
  m = t.match(/\bdays\s+in\s+milk\s+(\d+)\b/) || t.match(/\b(\d+)\s*days?\s+in\s+milk\b/);
  if (m) return { days: parseInt(m[1], 10), isDIM: true };
  // "day 20", "20 days"
  m = t.match(/\bday\s*(\d+)\b/) || t.match(/\b(\d+)\s*(?:days?)\b/);
  if (m) return { days: parseInt(m[1], 10), isDIM: false };
  // "week 3", "3 weeks" — never treat breed codes W-36 / W-80 / W-98 as "week 80"
  m = t.match(/\bweek\s*(\d+)\b/) || t.match(/\b(\d+)\s*(?:weeks?|wks?)\b/);
  if (m) return { days: Math.round(parseInt(m[1], 10) * 7), isDIM: false };
  // "w3" / "w12" for week number only (1–20). W-36 and W-80 are Hy-Line breeds.
  m = t.match(/\bw([1-9]|1[0-9]|20)\b/);
  if (m && !/\bw[\-\s]?(36|80|98)\b/i.test(t)) {
    return { days: Math.round(parseInt(m[1], 10) * 7), isDIM: false };
  }
  // "month 2", "2 months"
  m = t.match(/\bmonth\s*(\d+)\b/) || t.match(/\b(\d+)\s*(?:months?|mos?)\b/);
  if (m) return { days: Math.round(parseInt(m[1], 10) * 30), isDIM: false };
  return null;
}

// ─── Alias matching ───────────────────────────────────────
const FUZZY_THRESHOLD = 0.30; // normalized Levenshtein

function matchAlias(query, aliasList, threshold = FUZZY_THRESHOLD, noContainment = false) {
  const q = query.trim();
  if (!q) return { match: false, score: 1 };
  // exact
  if (aliasList.includes(q)) return { match: true, score: 0 };
  // substring containment — disabled for phase matching to prevent numeric false positives
  if (!noContainment && q.length >= 4) {
    for (const a of aliasList) {
      if (a.includes(q)) return { match: true, score: 0.05 };
      if (q.length >= 6 && q.includes(a)) return { match: true, score: 0.05 };
    }
  }
  // fuzzy
  let best = 1;
  for (const a of aliasList) {
    const d = normalizedDist(q, a);
    if (d < best) best = d;
  }
  if (best <= threshold) return { match: true, score: best };
  return { match: false, score: best };
}

function matchSubstringAliasStrict(queryTokens, aliasList, threshold = FUZZY_THRESHOLD) {
  return matchSubstringAliasInner(queryTokens, aliasList, threshold, true);
}

function matchSubstringAliasInner(queryTokens, aliasList, threshold, noContainment) {
  let bestScore = 1;
  let bestLen = 0;
  const n = queryTokens.length;
  for (let len = Math.min(n, 5); len >= 1; len--) {
    for (let start = 0; start <= n - len; start++) {
      const phrase = queryTokens.slice(start, start + len).join(' ');
      const res = matchAlias(phrase, aliasList, threshold, noContainment);
      if (res.match && (res.score < bestScore || (res.score === bestScore && len > bestLen))) {
        bestScore = res.score;
        bestLen = len;
      }
    }
  }
  return bestScore <= threshold ? { match: true, score: bestScore, len: bestLen } : { match: false, score: bestScore, len: 0 };
}

// Match a substring of the query against alias lists
// Tries all n-grams from the query text
function matchSubstringAlias(queryTokens, aliasList, threshold = FUZZY_THRESHOLD) {
  return matchSubstringAliasInner(queryTokens, aliasList, threshold, false);
}

// ─── Phase resolution from age ────────────────────────────
function phaseFromDays(ageDays, phases) {
  if (ageDays == null) return null;
  let best = null, bestOverlap = -1;
  for (const p of phases) {
    const [lo, hi] = p.day_range;
    if (ageDays >= lo && ageDays <= hi) {
      const overlap = hi - lo;
      if (best === null || overlap > bestOverlap) { best = p; bestOverlap = overlap; }
    }
  }
  if (best) return best;
  // fallback: nearest phase boundary
  let nearest = null, nearestDist = Infinity;
  for (const p of phases) {
    const [lo, hi] = p.day_range;
    const d = Math.min(Math.abs(ageDays - lo), Math.abs(ageDays - hi));
    if (d < nearestDist) { nearestDist = d; nearest = p; }
  }
  return nearest;
}

// ─── Core parse function ──────────────────────────────────
function parseDietRequest(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { error: 'No text provided', confidence: 0 };
  }

  const text = prepareText(rawText);
  const tokens = text.split(' ');

  // ── 1. Detect age (day/week/month) — use raw text so DIM/w# patterns work ──
  const ageResult = extractAgeDays(rawText);
  const ageDays = ageResult ? ageResult.days : null;
  const isDIM = ageResult ? ageResult.isDIM : false;

  // ── 2. Match type/category ──
  let matchedType = null;
  let typeScore = 1;
  let typeMatchLen = 0;

  const allTypes = Object.values(DIET_INTENT_DB);
  // Pass 1: match type-level aliases + all non-generic breed aliases simultaneously
  for (const typeObj of allTypes) {
    const typeAliases = [...typeObj.aliases, typeObj.type_label.toLowerCase(), typeObj.type];
    // Also include all breed aliases for this type so "cobb 500" → broiler
    const breedAliases = typeObj.breeds.flatMap(b =>
      b.key.includes('generic') ? [] : [...b.aliases, b.label.toLowerCase()]
    );
    const combined = [...typeAliases, ...breedAliases];
    const res = matchSubstringAlias(tokens, combined, 0.22);
    if (res.match && (res.score < typeScore || (res.score === typeScore && res.len > typeMatchLen))) {
      typeScore = res.score;
      typeMatchLen = res.len;
      matchedType = typeObj;
    }
  }

  // Pass 2 (fallback): try species-level aliases if no type matched yet
  if (!matchedType) {
    for (const [, speciesObj] of Object.entries(SPECIES_ALIASES)) {
      const res = matchSubstringAlias(tokens, speciesObj.aliases);
      if (res.match) {
        if (speciesObj.keys.length === 1) {
          matchedType = DIET_INTENT_DB[speciesObj.keys[0]];
          typeScore = res.score + 0.1;
        }
        break;
      }
    }
  }

  if (!matchedType) {
    return {
      error: 'Could not identify species/type from text',
      confidence: 0,
      raw: rawText,
      normalised: text,
    };
  }

  // ── 3. Match breed ──
  let matchedBreed = null;
  let breedScore = 1;
  let breedFallback = false;

  for (const breed of matchedType.breeds) {
    const aliases = [...breed.aliases, breed.label.toLowerCase(), breed.key];
    const res = matchSubstringAlias(tokens, aliases, 0.25);
    if (res.match && res.score < breedScore) {
      breedScore = res.score;
      matchedBreed = breed;
    }
  }

  if (!matchedBreed) {
    // Use fallback breed
    const fb = matchedType.breeds.find(b => b.key === matchedType.fallback_breed);
    matchedBreed = fb || matchedType.breeds[matchedType.breeds.length - 1];
    breedFallback = true;
    breedScore = 0.5;
  }

  // ── 4. Match phase ──
  let matchedPhase = null;
  let phaseScore = 1;
  let phaseMatchLen = 0;
  let phaseFallback = false;

  // When age in days was extracted, use phaseFromDays as the primary signal.
  // If DIM (days in milk) was specified, restrict to production/lactation phases to avoid
  // matching heifer/juvenile phases that share the same numeric range.
  if (ageDays !== null) {
    const dimKeywords = ['lactation','lay','milk','production','dim'];
    const agePhases = isDIM
      ? matchedType.phases.filter(p => dimKeywords.some(k => p.key.includes(k) || p.label.toLowerCase().includes(k)))
      : matchedType.phases;
    const phasesForAge = agePhases.length > 0 ? agePhases : matchedType.phases;
    const byDays = phaseFromDays(ageDays, phasesForAge);
    if (byDays) { matchedPhase = byDays; phaseScore = 0.03; phaseMatchLen = 99; }
  }

  // Try alias match without substring containment (strict mode) to avoid numeric false positives.
  // Only an exact (score=0) or very close fuzzy alias match overrides a day-range result.
  for (const phase of matchedType.phases) {
    const aliases = [...phase.aliases, phase.label.toLowerCase(), phase.key.replace(/_/g, ' ')];
    const res = matchSubstringAliasStrict(tokens, aliases, 0.28);
    if (res.match) {
      if (res.score < phaseScore || (res.score === phaseScore && res.len > phaseMatchLen)) {
        phaseScore = res.score;
        phaseMatchLen = res.len;
        matchedPhase = phase;
      }
    }
  }

  // If still none, pick first phase (loosest fallback)
  if (!matchedPhase) {
    matchedPhase = matchedType.phases[0];
    phaseFallback = true;
    phaseScore = 0.6;
  }

  // ── 5. Compute confidence ──
  // typeScore (0=exact, 1=no match), same for breed/phase
  // We want: high confidence = all low scores
  const rawConf = 1 - ((typeScore * 0.4) + (breedScore * 0.3) + (phaseScore * 0.3));
  const confidence = Math.max(0, Math.min(1, parseFloat(rawConf.toFixed(2))));

  const summary = [
    matchedType.type_label,
    breedFallback ? `(${matchedBreed.label} — generic fallback)` : matchedBreed.label,
    matchedPhase.label,
    ageDays !== null ? `[day ${ageDays}]` : '',
  ].filter(Boolean).join(' › ');

  return {
    species: matchedType.species,
    species_label: matchedType.species_label,
    type: matchedType.type,
    type_label: matchedType.type_label,
    type_key: matchedType.key,
    nutrix_key: matchedType.nutrix_key,
    breed: matchedBreed.key,
    breed_label: matchedBreed.label,
    nutrix_breed: matchedBreed.nutrix_breed,
    breed_fallback: breedFallback,
    phase: matchedPhase.key,
    phase_label: matchedPhase.label,
    phase_fallback: phaseFallback,
    age_days: ageDays,
    is_dim: isDIM,
    confidence,
    summary,
    raw: rawText,
    normalised: text,
  };
}

// ─── List all known types ────────────────────────────────
function listTypes() {
  return Object.values(DIET_INTENT_DB).map(t => ({
    key: t.key,
    species: t.species,
    type: t.type,
    label: t.type_label,
    breed_count: t.breeds.length,
    phase_count: t.phases.length,
  }));
}

// ─── List breeds for a type ──────────────────────────────
function listBreeds(typeKey) {
  const t = DIET_INTENT_DB[typeKey];
  if (!t) return null;
  return t.breeds.map(b => ({ key: b.key, label: b.label, nutrix_breed: b.nutrix_breed }));
}

// ─── List phases for a type ──────────────────────────────
function listPhases(typeKey) {
  const t = DIET_INTENT_DB[typeKey];
  if (!t) return null;
  return t.phases.map(p => ({
    key: p.key,
    label: p.label,
    day_range: p.day_range,
    week_range: p.week_range,
  }));
}

module.exports = { parseDietRequest, listTypes, listBreeds, listPhases };
