"use strict";

/**
 * AgroCore Intelligence Engine (AIE)
 * core/intelligence/aggregators/outcome.analyzer.cjs
 * 
 * Level 3: Links formula nutrient profiles to farm outcomes.
 * Builds nutrient-outcome correlation table used by recommender.
 */

const { getDb } = require("../db/aie.schema.cjs");
const { randomUUID } = require("crypto");

/**
 * Rebuild nutrient-outcome correlations from batch data.
 * For each nutrient key, bins values into ranges and
 * calculates average outcomes per range.
 */
function rebuildOutcomeCorrelations() {
  const db = getDb();

  // Get all batches that have both formulas and outcomes
  const batches = db.prepare(`
    SELECT 
      bo.batch_id, bo.species, bo.production,
      bo.fcr, bo.mortality_pct, bo.avg_daily_gain_kg,
      bo.health_score,
      bf.event_id
    FROM batch_outcomes bo
    JOIN batch_formulas bf ON bo.batch_id = bf.batch_id
    WHERE bf.event_id IS NOT NULL
      AND bo.fcr IS NOT NULL
  `).all();

  if (batches.length < 5) {
    return { status: 'insufficient_data', count: batches.length };
  }

  // For each batch, get its nutrient profile
  const getNutrients = db.prepare(`
    SELECT nutrient_key, actual_value
    FROM formula_nutrients
    WHERE event_id = ?
  `);

  // Build dataset: { nutrient_key -> [{value, fcr, gain, health}] }
  const nutrientData = {};

  for (const batch of batches) {
    const nutrients = getNutrients.all(batch.event_id);
    for (const n of nutrients) {
      if (n.actual_value == null) continue;
      if (!nutrientData[n.nutrient_key]) nutrientData[n.nutrient_key] = [];
      nutrientData[n.nutrient_key].push({
        species: batch.species,
        production: batch.production,
        value: n.actual_value,
        fcr: batch.fcr,
        gain: batch.avg_daily_gain_kg,
        health: batch.health_score,
        mortality: batch.mortality_pct
      });
    }
  }

  // For each nutrient, bin values and calculate averages
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO nutrient_outcome_correlations (
      id, species, production, nutrient_key,
      nutrient_range_min, nutrient_range_max,
      avg_fcr, avg_daily_gain, avg_health_score,
      sample_count, confidence, last_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  let correlationsBuilt = 0;
  const transaction = db.transaction(() => {
    for (const [key, dataPoints] of Object.entries(nutrientData)) {
      if (dataPoints.length < 5) continue;

      // Group by species+production
      const groups = {};
      for (const dp of dataPoints) {
        const gk = `${dp.species}|${dp.production}`;
        if (!groups[gk]) groups[gk] = [];
        groups[gk].push(dp);
      }

      for (const [gk, points] of Object.entries(groups)) {
        if (points.length < 3) continue;
        const [species, production] = gk.split('|');

        // Create quartile bins
        const values = points.map(p => p.value).sort((a, b) => a - b);
        const q1 = percentile(values, 25);
        const q2 = percentile(values, 50);
        const q3 = percentile(values, 75);

        const bins = [
          { min: null, max: q1, label: 'low' },
          { min: q1, max: q2, label: 'low-mid' },
          { min: q2, max: q3, label: 'high-mid' },
          { min: q3, max: null, label: 'high' }
        ];

        for (const bin of bins) {
          const binPoints = points.filter(p => {
            const inLow = bin.min == null || p.value >= bin.min;
            const inHigh = bin.max == null || p.value < bin.max;
            return inLow && inHigh;
          });

          if (binPoints.length < 2) continue;

          const avgFcr = avg(binPoints.map(p => p.fcr).filter(v => v != null));
          const avgGain = avg(binPoints.map(p => p.gain).filter(v => v != null));
          const avgHealth = avg(binPoints.map(p => p.health).filter(v => v != null));
          const confidence = Math.min(1, binPoints.length / 20);

          upsert.run(
            randomUUID(), species, production, key,
            bin.min, bin.max,
            avgFcr, avgGain, avgHealth,
            binPoints.length, confidence
          );
          correlationsBuilt++;
        }
      }
    }
  });

  transaction();
  return { status: 'ok', correlations: correlationsBuilt, batches: batches.length };
}

/**
 * Get outcome correlations for a nutrient
 * Returns which ranges of this nutrient correlate with best outcomes
 */
function getNutrientOutcomeCorrelations({ species, production, nutrient_key }) {
  const db = getDb();
  return db.prepare(`
    SELECT *
    FROM nutrient_outcome_correlations
    WHERE species = ? AND production = ? AND nutrient_key = ?
    ORDER BY avg_fcr ASC
  `).all(species, production, nutrient_key);
}

/**
 * Get best performing nutrient ranges for a species+production
 * Returns the optimal ranges based on outcome data
 */
function getOptimalNutrientRanges({ species, production, min_samples = 3 }) {
  const db = getDb();
  return db.prepare(`
    SELECT 
      nutrient_key,
      nutrient_range_min,
      nutrient_range_max,
      avg_fcr,
      avg_daily_gain,
      avg_health_score,
      sample_count,
      confidence
    FROM nutrient_outcome_correlations
    WHERE species = ? AND production = ?
      AND sample_count >= ?
      AND confidence >= 0.2
    ORDER BY nutrient_key, avg_fcr ASC
  `).all(species, production, min_samples);
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

module.exports = {
  rebuildOutcomeCorrelations,
  getNutrientOutcomeCorrelations,
  getOptimalNutrientRanges
};
