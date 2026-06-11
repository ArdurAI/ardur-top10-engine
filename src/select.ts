/**
 * Top-10 selection — pick the ten strongest clusters per topic (and globally),
 * with stability/delta vs the previous cycle.
 *
 * SCAFFOLD ONLY. Selection consumes a `RankingArtifact` and the previous
 * cycle's `Top10Artifact` (for deltas + carry-over). References are built
 * copyright-safe: capped, deduped, attribution + canonical links only.
 */

import type {
  RankingArtifact,
  Top10Artifact,
  Top10Entry,
  RankedCluster,
  SourceRef,
} from './contracts.ts';

export interface SelectionOptions {
  /** Entries per topic. Default 10. */
  size?: number;
  /** Max references kept per entry. Default 5. */
  maxReferences?: number;
  /**
   * Anti-churn hysteresis: an incumbent within this rank-score band of the
   * challenger is retained, to stop the Top-10 thrashing every cycle. Default 0.
   */
  stabilityMargin?: number;
}

/** Build the copyright-safe reference list for one ranked cluster. */
export function referencesFor(
  _cluster: RankedCluster,
  _maxReferences: number,
): SourceRef[] {
  throw new Error('not implemented: dedup + cap, attribution + canonical links only');
}

/** Compute rank movement vs the previous cycle's Top-10. */
export function computeDelta(
  _entry: Pick<Top10Entry, 'clusterId' | 'rank'>,
  _previous: Top10Entry[] | null,
): Top10Entry['delta'] {
  throw new Error('not implemented');
}

/**
 * Select the Top-10 per topic and the global Top-10, attach deltas + stability,
 * and return a `Top10Artifact` (with `nextRefreshAt = cycle.windowEnd`).
 */
export function selectTop10(
  _ranking: RankingArtifact,
  _previous: Top10Artifact | null,
  _options: SelectionOptions = {},
): Top10Artifact {
  throw new Error('not implemented: rank -> top-N per topic + global -> deltas -> stability');
}
