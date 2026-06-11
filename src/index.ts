/**
 * ardur-top10-engine — public entrypoint.
 *
 * Stage 3 of the Ardur content pipeline + the pipeline's ORCHESTRATOR. Selects
 * the Top-10 per topic (and globally) from a `RankingArtifact`, attaches
 * stability/deltas vs the previous cycle, and emits a `Top10Artifact` for
 * `ardur-article-synthesizer`. Also owns the 6-hour refresh loop (orchestrate.ts).
 *
 * SCAFFOLD ONLY — wiring/signatures are final; module bodies are stubs.
 */

export * from './contracts.ts';
export { selectTop10, referencesFor, computeDelta } from './select.ts';
export type { SelectionOptions } from './select.ts';
export { runCycle } from './orchestrate.ts';
export type { StageRunners, CyclePublishSet, OrchestrationResult } from './orchestrate.ts';
export { cycleFor, previousCycle, nextRefreshAt } from './cycle.ts';
