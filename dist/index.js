/**
 * ardur-top10-engine — public entrypoint.
 *
 * Stage 3 of the Ardur content pipeline + the pipeline's ORCHESTRATOR. Selects
 * the Top-10 per topic (and globally) from a `RankingArtifact`, attaches
 * stability/deltas vs the previous cycle, and emits a `Top10Artifact` for
 * `ardur-article-synthesizer`. Also owns the 6-hour refresh loop (orchestrate.ts).
 */
export * from '@ardurai/contracts';
// Selection (pure core)
export { selectTop10, referencesFor, computeDelta, compareClusters, DEFAULT_SIZE, } from "./select.js";
// References (copyright-safe)
export { indexItems, referencesFromCluster, DEFAULT_MAX_REFERENCES } from "./references.js";
// URL safety
export { safePublicUrl } from "./url.js";
// Stability / deltas
export { computeStability, incumbentIds, indexByCluster } from "./stability.js";
// Orchestration
export { runCycle } from "./orchestrate.js";
// Cycle math
export { cycleFor, previousCycle, nextCycle, nextRefreshAt, CYCLE_INTERVAL_MS } from "./cycle.js";
