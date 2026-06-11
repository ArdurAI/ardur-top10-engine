/**
 * Top-10 selection — pick the ten strongest clusters per topic (and globally),
 * with copyright-safe references, cross-cycle deltas, and stability vs the
 * previous cycle.
 *
 * `selectTop10(ranking, previous, options)` is a **pure function of its inputs**:
 * same `RankingArtifact` + same previous Top-10 ⇒ byte-identical `Top10Artifact`.
 * That determinism is what makes a re-run of a `cycle.id` idempotent
 * (docs/research-notes.md §2). No I/O, no wall-clock reads.
 *
 * Tie-breaking order (issue #2, documented + tested):
 *   total score → corroboration → recency (latestPublishedAt) → distinct domains
 *   → stable clusterId.
 *
 * Category balancing: the global board caps how many slots any one category
 * (topic) may hold, so a single category cannot crowd out the board; if the cap
 * leaves the board under-filled, a relax pass tops it up by score.
 *
 * Anti-churn: `stabilityMargin` hysteresis biases *membership* toward incumbents
 * (an incumbent within the margin of a challenger keeps its slot); ordering
 * within the board always uses the honest comparator.
 */
import type { RankingArtifact, Top10Artifact, RankedCluster, AggregationArtifact } from '@ardurai/contracts';
import { referencesFor } from './references.ts';
import { computeDelta } from './stability.ts';
export interface SelectionOptions {
    /** Entries per topic and for the global board. Default 10. */
    size?: number;
    /** Max references kept per entry. Default 5. */
    maxReferences?: number;
    /**
     * Anti-churn hysteresis: an incumbent whose real score is within this band of
     * a challenger is retained for *membership*, to stop the board thrashing every
     * cycle. Ordering within the board is unaffected. Default 0 (faithful re-rank).
     */
    stabilityMargin?: number;
    /**
     * Max slots one category (topic) may hold in the GLOBAL board. Defaults to a
     * value that balances while still filling: `max(1, ceil(size / 3))`. Set to
     * `Infinity` to disable balancing. Ignored for per-topic boards.
     */
    maxPerCategory?: number;
    /**
     * The `rankedByTopic` key that already represents the union/"all" board, if the
     * ranking engine produced one. When present it is used as the global source and
     * excluded from per-topic boards. Auto-detected from `all` / `global` otherwise.
     */
    globalTopicKey?: string;
    /**
     * Aggregation artifact for the same cycle, used to resolve `cluster.memberIds`
     * into copyright-safe references. Without it, references resolve to `[]`.
     */
    aggregation?: AggregationArtifact;
    /** Override the emitted artifact `runId`. Default `top10:<cycle.id>`. */
    runId?: string;
    /** Override the emitted artifact `generatedAt`. Default `ranking.generatedAt`. */
    generatedAt?: string;
}
export declare const DEFAULT_SIZE = 10;
export { referencesFor, computeDelta };
/**
 * Total-order comparator over the honest score fields. Returns < 0 if `a` should
 * rank ahead of `b`. Tie-break order per issue #2; final `clusterId` tie-break
 * guarantees a deterministic total order (no reliance on sort stability).
 */
export declare function compareClusters(a: RankedCluster, b: RankedCluster): number;
/**
 * Select the Top-10 per topic and the global Top-10, attach deltas + stability,
 * and return a `Top10Artifact` (`nextRefreshAt = cycle.windowEnd`).
 */
export declare function selectTop10(ranking: RankingArtifact, previous: Top10Artifact | null, options?: SelectionOptions): Top10Artifact;
