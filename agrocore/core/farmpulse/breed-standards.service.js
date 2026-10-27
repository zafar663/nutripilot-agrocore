// ─── Breed Standards Service (AgroCore) ──────────────────────────────────────
// Server-side equivalent of feedbot breed-standards.data.js
// Loaded by perf-analyze.route.js
// ─────────────────────────────────────────────────────────────────────────────

// TODO: import from shared data file or load from DB
// Option A: import static data (same as feedbot)
// Option B: load from farmpulse SQLite DB (breed_standards table)

function lookupStandard({ breed, age, ageUnit = 'day' }) {
  // TODO: implement
  return null;
}

function analyzePerformance({ breed, age, ageUnit, kpis }) {
  const standard = lookupStandard({ breed, age, ageUnit });
  if (!standard) return { ok: false, error: 'NO_STANDARD' };
  // TODO: implement deviation computation
  return { ok: true, standard, deviations: [], overall: 'OK' };
}

export { lookupStandard, analyzePerformance };
