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
export {
  selectTop10,
  referencesFor,
  computeDelta,
  compareClusters,
  DEFAULT_SIZE,
} from './select.ts';
export type { SelectionOptions } from './select.ts';

// References (copyright-safe)
export { indexItems, referencesFromCluster, DEFAULT_MAX_REFERENCES } from './references.ts';
export type { ItemsById } from './references.ts';

// URL safety
export { safePublicUrl } from './url.ts';

// Stability / deltas
export { computeStability, incumbentIds, indexByCluster } from './stability.ts';

// Orchestration
export { runCycle } from './orchestrate.ts';
export type {
  StageRunners,
  CyclePublishSet,
  OrchestrationResult,
  RunCycleOptions,
} from './orchestrate.ts';

// Cycle math
export { cycleFor, previousCycle, nextCycle, nextRefreshAt, CYCLE_INTERVAL_MS } from './cycle.ts';
