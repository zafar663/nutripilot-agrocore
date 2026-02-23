/**
 * Optional regex rules for messy tokens.
 * Keep these conservative (high confidence only).
 */
export const ALIAS_RULES = [
  // soybean meal variants like "SBM-48", "Soybean meal (48%)"
  { key: "soybean_meal", re: /\b(sb m|sbm)\b.*\b(46|48)\b/i },
  { key: "soybean_meal", re: /\bsoy(bean)?\s*meal\b.*\b(46|48)\b/i },

  // DL-Met variants
  { key: "dl_methionine", re: /\b(dl)\s*[- ]?\s*(met|methionine)\b/i },

  // NaHCO3
  { key: "sodium_bicarbonate", re: /\bna\s*hco\s*3\b/i }
];
