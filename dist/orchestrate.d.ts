/**
 * Orchestration — drive one full 6-hour pipeline cycle end to end.
 *
 * The conductor for the whole pipeline:
 *   aggregate -> rank -> selectTop10 -> synthesize -> publish.
 *
 * It depends on the other engines only through their JSON artifacts (and/or
 * their CLIs), injected as `StageRunners`, never their internals. Properties:
 *
 *  - **Idempotent per `cycle.id`** — the cycle is derived from `floor(now, 6h)`
 *    UTC, so a drifted/retried/backfilled trigger resolves to the same cycle; an
 *    optional `loadPublished` guard makes a re-fire a cheap no-op.
 *  - **Last-good-wins** — if any stage throws, nothing is published and the
 *    previous cycle stays live. Publishing is all-or-nothing per cycle.
 *  - **Traceable** — `selectTop10` threads `upstreamRunId`/`cycle` through the
 *    Top-10 artifact; the injected runners do the same for their stages.
 *
 * See docs/research-notes.md §1, §2, §4 for the reasoning.
 */
import type { AggregationArtifact, RankingArtifact, Top10Artifact, ArticleArtifact, CycleMeta } from '@ardurai/contracts';
import { type SelectionOptions } from './select.ts';
/** Pluggable stage runners — wired to the sibling engines (lib import or CLI). */
export interface StageRunners {
    aggregate: (cycle: CycleMeta) => Promise<AggregationArtifact>;
    rank: (aggregation: AggregationArtifact) => Promise<RankingArtifact> | RankingArtifact;
    synthesize: (top10: Top10Artifact, aggregation: AggregationArtifact) => Promise<ArticleArtifact>;
    publish: (artifacts: CyclePublishSet) => Promise<void>;
    /** Load the previous cycle's Top-10 (for deltas/stability). `null` if none. */
    loadPreviousTop10: (cycle: CycleMeta) => Promise<Top10Artifact | null>;
    /**
     * Optional idempotency guard: return the already-published Top-10 for THIS
     * cycle if it exists, so a re-run short-circuits instead of re-publishing. When
     * omitted, every invocation runs the full cycle (still idempotent at the sink
     * because run IDs are deterministic).
     */
    loadPublished?: (cycle: CycleMeta) => Promise<Top10Artifact | null>;
}
export interface CyclePublishSet {
    cycle: CycleMeta;
    aggregation: AggregationArtifact;
    ranking: RankingArtifact;
    top10: Top10Artifact;
    articles: ArticleArtifact;
}
export interface OrchestrationResult {
    cycle: CycleMeta;
    status: 'published' | 'degraded' | 'failed';
    warnings: string[];
    nextRefreshAt: string;
}
export interface RunCycleOptions {
    /** Instant used to derive the cycle. Default `new Date()`. Pass to backfill. */
    now?: Date;
    /** Selection tuning (size, stabilityMargin, category cap, ...). */
    selection?: SelectionOptions;
}
export declare function errMessage(e: unknown): string;
/**
 * Run one cycle. The top10-engine owns selection itself (`select.ts`); the other
 * three stages are injected via `runners`. Never throws for an expected pipeline
 * failure — failures surface as `status: 'failed' | 'degraded'` with `warnings`.
 */
export declare function runCycle(runners: StageRunners, options?: RunCycleOptions): Promise<OrchestrationResult>;
