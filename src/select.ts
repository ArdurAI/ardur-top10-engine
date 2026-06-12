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

import type {
  RankingArtifact,
  Top10Artifact,
  Top10Data,
  Top10Entry,
  RankedCluster,
  AggregationArtifact,
} from '@ardurai/contracts';
import { SCHEMA_VERSION, CONTRACT_REVISION, assertCompatibleArtifact } from '@ardurai/contracts';
import { nextRefreshAt } from './cycle.ts';
import {
  referencesFor,
  referencesFromCluster,
  indexItems,
  DEFAULT_MAX_REFERENCES,
  type ItemsById,
} from './references.ts';
import { computeDelta, computeStability, incumbentIds } from './stability.ts';

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

export const DEFAULT_SIZE = 10;

/** Candidate keys treated as a pre-merged global/"all" board if present. */
const GLOBAL_KEYS = ['all', 'global'] as const;

/**
 * Object.prototype own-property names that must never be used as topic keys.
 *
 * JSON.parse creates object properties via [[DefineOwnProperty]], not [[Set]], so a
 * key like "__proto__" becomes an own enumerable property on the parsed object.
 * Later assigning that key to a plain `{}` output map invokes the __proto__ setter
 * on Object.prototype and silently corrupts the map's prototype chain (CWE-915).
 * We reject these keys at ingestion time rather than trying to route around the hazard.
 */
const RESERVED_TOPIC_KEYS: ReadonlySet<string> = new Set(
  Object.getOwnPropertyNames(Object.prototype),
);

// Re-exported so the public surface (index.ts) stays stable.
export { referencesFor, computeDelta };

/**
 * Coerce a non-finite or non-numeric value to -Infinity so every sort comparison
 * produces a finite, deterministic result. Clusters with degenerate scores sort
 * to the bottom rather than breaking the comparator (issue #16).
 */
function toFinite(v: number): number {
  return Number.isFinite(v) ? v : -Infinity;
}

/**
 * Total-order comparator over the honest score fields. Returns < 0 if `a` should
 * rank ahead of `b`. Tie-break order per issue #2; final `clusterId` tie-break
 * guarantees a deterministic total order (no reliance on sort stability).
 *
 * All numeric fields are normalised through `toFinite` so NaN or non-finite
 * inputs never produce a NaN comparison result (issue #16).
 */
export function compareClusters(a: RankedCluster, b: RankedCluster): number {
  const ta = toFinite(a.score.total);
  const tb = toFinite(b.score.total);
  if (ta !== tb) return tb - ta;
  const ca = toFinite(a.score.corroboration);
  const cb = toFinite(b.score.corroboration);
  if (ca !== cb) return cb - ca;
  const ra = Date.parse(a.latestPublishedAt);
  const rb = Date.parse(b.latestPublishedAt);
  const va = Number.isNaN(ra) ? -Infinity : ra;
  const vb = Number.isNaN(rb) ? -Infinity : rb;
  if (va !== vb) return vb - va; // more recent first
  const da = toFinite(a.distinctDomains);
  const db = toFinite(b.distinctDomains);
  if (da !== db) return db - da;
  if (a.clusterId !== b.clusterId) return a.clusterId < b.clusterId ? -1 : 1;
  return 0;
}

/**
 * Membership selection with optional incumbent hysteresis, category cap, and
 * headline dedup, then honest ordering. Returns the chosen clusters in final
 * board order.
 */
function selectBoard(
  clusters: readonly RankedCluster[],
  opts: {
    size: number;
    stabilityMargin: number;
    incumbents: ReadonlySet<string>;
    maxPerCategory: number;
  },
): RankedCluster[] {
  const { size, stabilityMargin, incumbents, maxPerCategory } = opts;
  if (size <= 0 || clusters.length === 0) return [];

  // Selection comparator: compare the *boosted* total (incumbents get +margin),
  // then fall back to the honest tie-breaks. This is the only place hysteresis
  // applies — it decides who is in, never the displayed order.
  const boostedTotal = (c: RankedCluster): number =>
    toFinite(c.score.total) + (incumbents.has(c.clusterId) ? stabilityMargin : 0);

  const bySelection = [...clusters].sort((a, b) => {
    const ba = boostedTotal(a);
    const bb = boostedTotal(b);
    if (ba !== bb) return bb - ba;
    return compareClusters(a, b);
  });

  // Greedy fill honoring the per-category cap.
  // seenClusterIds: defensive guard against duplicate clusterId values in input.
  // seenHeadlines: cross-stream same-story dedup — the pipeline may assign different
  //   clusterIds to the same story across topic streams; normalised headline is the
  //   content signal that catches those duplicates before they reach the board.
  const chosen: RankedCluster[] = [];
  const perCategory = new Map<string, number>();
  const seenClusterIds = new Set<string>();
  const seenHeadlines = new Set<string>();
  const overflow: RankedCluster[] = [];
  for (const c of bySelection) {
    if (chosen.length >= size) break;
    if (seenClusterIds.has(c.clusterId)) continue;
    const hk = c.headline.trim().toLowerCase();
    if (seenHeadlines.has(hk)) continue;
    const count = perCategory.get(c.topic) ?? 0;
    if (count >= maxPerCategory) {
      overflow.push(c);
      continue;
    }
    chosen.push(c);
    seenClusterIds.add(c.clusterId);
    seenHeadlines.add(hk);
    perCategory.set(c.topic, count + 1);
  }
  // Relax pass: if the cap left the board under-filled, top up by selection order.
  if (chosen.length < size) {
    for (const c of overflow) {
      if (chosen.length >= size) break;
      if (seenClusterIds.has(c.clusterId)) continue;
      const hk = c.headline.trim().toLowerCase();
      if (seenHeadlines.has(hk)) continue;
      chosen.push(c);
      seenClusterIds.add(c.clusterId);
      seenHeadlines.add(hk);
    }
  }

  // Honest final ordering, independent of hysteresis/cap.
  chosen.sort(compareClusters);
  return chosen;
}

/** Project a ranked cluster into a Top10Entry at a given rank. */
function toEntry(
  cluster: RankedCluster,
  rank: number,
  previousBoard: readonly Top10Entry[] | null,
  previousIds: ReadonlySet<string>,
  maxReferences: number,
  itemsById: ItemsById,
): Top10Entry {
  // Rev 3: if the ranking engine pre-built references, use them all (uncapped).
  // Display capping is the renderer's responsibility — data carries the full set.
  // Fall back to memberIds resolution for rev 1/2 producers.
  const references =
    cluster.references !== undefined
      ? referencesFromCluster(cluster.references)
      : referencesFor(cluster, maxReferences, itemsById);

  const entry: Top10Entry = {
    rank,
    clusterId: cluster.clusterId,
    topic: cluster.topic,
    topicLabel: cluster.topicLabel,
    headline: cluster.headline,
    score: cluster.score,
    sourceQuality: cluster.sourceQuality,
    confidence: cluster.confidence,
    references,
    delta: computeDelta({ clusterId: cluster.clusterId, rank }, previousBoard),
    carriedOver: previousIds.has(cluster.clusterId),
  };

  // Rev 3: forward sourceDocIds for the full provenance trail.
  if (cluster.sourceDocIds !== undefined) {
    entry.sourceDocIds = cluster.sourceDocIds;
  }

  return entry;
}

/** Build a finished board (entries with ranks/deltas/refs) from raw clusters. */
function buildBoard(
  clusters: readonly RankedCluster[],
  previousBoard: readonly Top10Entry[] | null,
  cfg: { size: number; stabilityMargin: number; maxPerCategory: number; maxReferences: number },
  itemsById: ItemsById,
): Top10Entry[] {
  const incumbents = incumbentIds(previousBoard);
  const previousIds = incumbents;
  const chosen = selectBoard(clusters, {
    size: cfg.size,
    stabilityMargin: cfg.stabilityMargin,
    incumbents,
    maxPerCategory: cfg.maxPerCategory,
  });
  return chosen.map((cluster, i) =>
    toEntry(cluster, i + 1, previousBoard, previousIds, cfg.maxReferences, itemsById),
  );
}

/** Dedup clusters across topics by `clusterId`, keeping the strongest. */
function unionByCluster(
  rankedByTopic: Record<string, RankedCluster[]>,
  exclude: Set<string>,
): RankedCluster[] {
  const best = new Map<string, RankedCluster>();
  for (const [topic, clusters] of Object.entries(rankedByTopic)) {
    if (exclude.has(topic)) continue;
    for (const c of clusters ?? []) {
      const existing = best.get(c.clusterId);
      if (!existing) {
        best.set(c.clusterId, c);
        continue;
      }
      const cmp = compareClusters(c, existing);
      // On a genuine tie (cmp === 0), use topic key as a stable final tie-break
      // so Object.entries insertion order cannot affect the winner (issue #9).
      if (cmp < 0 || (cmp === 0 && c.topic < existing.topic)) best.set(c.clusterId, c);
    }
  }
  return [...best.values()];
}

/**
 * Select the Top-10 per topic and the global Top-10, attach deltas + stability,
 * and return a `Top10Artifact` (`nextRefreshAt = cycle.windowEnd`).
 */
export function selectTop10(
  ranking: RankingArtifact,
  previous: Top10Artifact | null,
  options: SelectionOptions = {},
): Top10Artifact {
  // Gate before stamp: reject incompatible upstream artifacts (ARCHITECTURE §5).
  const { warnings: gateWarnings } = assertCompatibleArtifact(ranking as unknown, 'ranking');

  const size = options.size ?? DEFAULT_SIZE;
  const maxReferences = options.maxReferences ?? DEFAULT_MAX_REFERENCES;
  const stabilityMargin = options.stabilityMargin ?? 0;
  const maxPerCategory = options.maxPerCategory ?? Math.max(1, Math.ceil(size / 3));

  const rawRankedByTopic = ranking.data.rankedByTopic ?? {};
  const warnings = [...ranking.warnings, ...gateWarnings];

  // Sanitize topic keys: reject any that shadow Object.prototype own properties.
  // Object.entries returns JSON.parse-created "__proto__" as an own enumerable entry;
  // assigning such a key to a plain-object output map would invoke the __proto__
  // setter and silently corrupt the map's prototype chain (CWE-915).
  const rankedByTopic: Record<string, RankedCluster[]> = {};
  for (const [k, v] of Object.entries(rawRankedByTopic)) {
    if (RESERVED_TOPIC_KEYS.has(k)) {
      warnings.push(`topic key rejected (reserved name): "${k}"`);
    } else {
      rankedByTopic[k] = (v ?? []) as RankedCluster[];
    }
  }

  // References: Rev 3 clusters carry pre-built references from the ranking engine
  // (RankedCluster.references). For rev 1/2 producers that omit the field, fall
  // back to memberIds resolution which requires the AggregationArtifact.
  const allClusters = Object.values(rankedByTopic).flat() as RankedCluster[];
  const legacyClusters = allClusters.filter((c) => c.references === undefined);

  let itemsById: ItemsById = Object.create(null);
  if (options.aggregation) {
    const allItems = Object.values(options.aggregation.data.itemsByTopic ?? {}).flat();
    itemsById = indexItems(allItems);
  } else if (legacyClusters.length > 0) {
    warnings.push(
      `references omitted for ${legacyClusters.length} legacy cluster(s): no aggregation artifact provided to selectTop10`,
    );
  }

  // Identify the global/"all" source key, if the ranking already merged one.
  const globalKey =
    options.globalTopicKey ??
    GLOBAL_KEYS.find((k) => Object.prototype.hasOwnProperty.call(rankedByTopic, k));
  const excluded = new Set<string>(globalKey ? [globalKey] : []);

  const boardCfg = { size, stabilityMargin, maxReferences };

  // Per-topic boards (every real topic key with at least one cluster).
  const top10ByTopic: Record<string, Top10Entry[]> = {};
  const topicKeys = Object.keys(rankedByTopic)
    .filter((k) => !excluded.has(k))
    .sort();
  for (const topic of topicKeys) {
    const clusters = rankedByTopic[topic] ?? [];
    if (clusters.length === 0) continue;
    const prevBoard = previous?.data.top10ByTopic[topic] ?? null;
    // Per-topic: one category, so the category cap is a no-op (= size).
    const board = buildBoard(clusters, prevBoard, { ...boardCfg, maxPerCategory: size }, itemsById);
    if (board.length > 0) top10ByTopic[topic] = board;
  }

  // Global board: from the pre-merged "all" key if present, else the union of all
  // topic clusters deduped by clusterId, with category balancing applied.
  const globalSource = globalKey
    ? unionByCluster({ [globalKey]: rankedByTopic[globalKey] ?? [] }, new Set())
    : unionByCluster(rankedByTopic, excluded);
  const global = buildBoard(
    globalSource,
    previous?.data.global ?? null,
    { ...boardCfg, maxPerCategory },
    itemsById,
  );

  if (global.length < size) {
    warnings.push(`global board under-filled: ${global.length}/${size} slots`);
  }

  const stability = computeStability(global, previous?.data.global ?? null);

  const data: Top10Data = {
    nextRefreshAt: nextRefreshAt(ranking.cycle),
    topicsCovered: Object.keys(top10ByTopic).sort(),
    top10ByTopic,
    global,
    stability,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    contractRevision: CONTRACT_REVISION,
    artifact: 'top10',
    runId: options.runId ?? `top10:${ranking.cycle.id}`,
    upstreamRunId: ranking.runId,
    generatedAt: options.generatedAt ?? ranking.generatedAt,
    cycle: ranking.cycle,
    topics: ranking.topics,
    warnings,
    data,
  };
}
