import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

/** Fire-and-forget learning ingest. Never throws. */
export function learn(evt) {
  try {
    require("../../../core/intelligence/AIE.cjs").onActivity(evt);
  } catch (_) { /* never block product APIs */ }
}
