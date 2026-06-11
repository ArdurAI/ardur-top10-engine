/**
 * Deterministic test fixtures — small, hand-built artifacts for the unit tests.
 *
 * Not part of the runtime surface (not exported from index.ts). Every factory
 * has fixed defaults so tests are reproducible: no clocks, no randomness.
 */

import { SCHEMA_VERSION } from '@ardurai/contracts';
import type {
  AggregatedItem,
  AggregationArtifact,
  AggregationData,
  CycleMeta,
  InteractionMetrics,
  RankedCluster,
  RankingArtifact,
  RankingData,
  ScoreBreakdown,
  Top10Artifact,
  Top10Data,
  Top10Entry,
  TopicMeta,
} from '@ardurai/contracts';

export const CYCLE: CycleMeta = {
  id: '2026-06-11T06:00:00.000Z',
  windowStart: '2026-06-11T06:00:00.000Z',
  windowEnd: '2026-06-11T12:00:00.000Z',
};

export const TOPICS: TopicMeta[] = [
  { id: 'ai', label: 'AI', description: 'AI news' },
  { id: 'security', label: 'Security', description: 'Security news' },
];

export function makeScore(total: number, over: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    interaction: 0,
    credibility: 0,
    recency: 0,
    diversity: 0,
    corroboration: 0,
    total,
    weights: { interaction: 1, credibility: 1, recency: 1, diversity: 1, corroboration: 1 },
    ...over,
  };
}

export function makeCluster(over: Partial<RankedCluster> & { clusterId: string }): RankedCluster {
  return {
    topic: 'ai',
    topicLabel: 'AI',
    headline: `Headline ${over.clusterId}`,
    rank: 1,
    score: makeScore(1),
    sourceQuality: 'multi-source',
    confidence: 'medium',
    verification: 'multi-source',
    sourceCount: 2,
    distinctDomains: 2,
    tierHistogram: { news: 2 },
    memberIds: [],
    earliestPublishedAt: '2026-06-11T06:05:00.000Z',
    latestPublishedAt: '2026-06-11T06:30:00.000Z',
    auditId: `audit-${over.clusterId}`,
    ...over,
  };
}

export function makeRanking(
  rankedByTopic: Record<string, RankedCluster[]>,
  over: Partial<RankingArtifact> = {},
): RankingArtifact {
  const data: RankingData = {
    rankedByTopic,
    audit: [],
    weightProfile: 'balanced@v1',
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    artifact: 'ranking',
    runId: 'ranking:2026-06-11T06:00:00.000Z',
    upstreamRunId: 'aggregation:2026-06-11T06:00:00.000Z',
    generatedAt: '2026-06-11T06:40:00.000Z',
    cycle: CYCLE,
    topics: TOPICS,
    warnings: [],
    data,
    ...over,
  };
}

export function makeInteraction(over: Partial<InteractionMetrics> = {}): InteractionMetrics {
  return {
    feedRank: 0,
    shares: null,
    comments: null,
    reactions: null,
    crossSourceMentions: 2,
    velocity: null,
    capturedAt: '2026-06-11T06:35:00.000Z',
    provenance: 'rss-position',
    ...over,
  };
}

export function makeItem(over: Partial<AggregatedItem> & { id: string }): AggregatedItem {
  return {
    topic: 'ai',
    topicLabel: 'AI',
    title: `Title ${over.id}`,
    source: 'Reuters',
    sourceDomain: 'reuters.com',
    sourceUrl: 'https://reuters.com',
    url: `https://reuters.com/article/${over.id}`,
    tier: 'news',
    publishedAt: '2026-06-11T06:20:00.000Z',
    summaryHint: 'SHOULD-NOT-LEAK metadata hint',
    interaction: makeInteraction(),
    clusterId: 'c1',
    fingerprint: `fp-${over.id}`,
    ...over,
  };
}

export function makeAggregation(
  itemsByTopic: Record<string, AggregatedItem[]>,
  over: Partial<AggregationArtifact> = {},
): AggregationArtifact {
  const data: AggregationData = {
    itemsByTopic,
    clustersByTopic: {},
    coverageByTopic: {},
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    artifact: 'aggregation',
    runId: 'aggregation:2026-06-11T06:00:00.000Z',
    upstreamRunId: null,
    generatedAt: '2026-06-11T06:10:00.000Z',
    cycle: CYCLE,
    topics: TOPICS,
    warnings: [],
    data,
    ...over,
  };
}

export function makeTop10Entry(
  over: Partial<Top10Entry> & { clusterId: string; rank: number },
): Top10Entry {
  return {
    topic: 'ai',
    topicLabel: 'AI',
    headline: `Headline ${over.clusterId}`,
    score: makeScore(1),
    sourceQuality: 'multi-source',
    confidence: 'medium',
    references: [],
    delta: { previousRank: null, movement: 'new' },
    carriedOver: false,
    ...over,
  };
}

export function makeTop10(
  global: Top10Entry[],
  top10ByTopic: Record<string, Top10Entry[]> = {},
  over: Partial<Top10Artifact> = {},
): Top10Artifact {
  const data: Top10Data = {
    nextRefreshAt: CYCLE.windowEnd,
    topicsCovered: Object.keys(top10ByTopic),
    top10ByTopic,
    global,
    stability: { carriedOver: 0, fresh: global.length, churnRate: 0 },
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    artifact: 'top10',
    runId: 'top10:2026-06-11T06:00:00.000Z',
    upstreamRunId: 'ranking:2026-06-11T06:00:00.000Z',
    generatedAt: '2026-06-11T06:45:00.000Z',
    cycle: CYCLE,
    topics: TOPICS,
    warnings: [],
    data,
    ...over,
  };
}
