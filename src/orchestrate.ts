/**
 * Orchestration — drive one full 6-hour pipeline cycle end to end.
 *
 * SCAFFOLD ONLY. This is the conductor for the whole pipeline:
 *   aggregate -> rank -> select Top-10 -> synthesize -> publish.
 *
 * It depends on the other engines only through their JSON artifacts (and/or
 * their CLIs), never their internals. Each stage is idempotent per cycle.id, so
 * a partial failure is safe to re-run. On total stage failure, the previous
 * cycle's published artifacts remain live (last-good-wins).
 */

import type {
  AggregationArtifact,
  RankingArtifact,
  Top10Artifact,
  ArticleArtifact,
  CycleMeta,
} from './contracts.ts';

/** Pluggable stage runners — wired to the sibling engines (lib import or CLI). */
export interface StageRunners {
  aggregate: (cycle: CycleMeta) => Promise<AggregationArtifact>;
  rank: (aggregation: AggregationArtifact) => Promise<RankingArtifact> | RankingArtifact;
  synthesize: (
    top10: Top10Artifact,
    aggregation: AggregationArtifact,
  ) => Promise<ArticleArtifact>;
  publish: (artifacts: CyclePublishSet) => Promise<void>;
  loadPreviousTop10: (cycle: CycleMeta) => Promise<Top10Artifact | null>;
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

/**
 * Run one cycle. The top10-engine owns selection itself (`select.ts`); the other
 * three stages are injected via `runners` so this repo stays independently
 * developable and testable.
 */
export function runCycle(
  _runners: StageRunners,
  _options: { now?: Date } = {},
): Promise<OrchestrationResult> {
  throw new Error('not implemented: aggregate -> rank -> selectTop10 -> synthesize -> publish');
}
