import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCycle, type StageRunners, type CyclePublishSet } from './orchestrate.ts';
import { SCHEMA_VERSION } from '@ardurai/contracts';
import type {
  AggregationArtifact,
  ArticleArtifact,
  RankingArtifact,
  Top10Artifact,
} from '@ardurai/contracts';
import { CYCLE, makeAggregation, makeCluster, makeRanking, makeScore } from './fixtures.ts';

function makeArticles(top10: Top10Artifact, warnings: string[] = []): ArticleArtifact {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifact: 'articles',
    runId: `articles:${top10.cycle.id}`,
    upstreamRunId: top10.runId,
    generatedAt: top10.generatedAt,
    cycle: top10.cycle,
    topics: top10.topics,
    warnings,
    data: {
      articles: [],
      copyrightPolicy: {
        originalTextOnly: true,
        maxQuoteWords: 25,
        reproduceArticleBody: false,
        requireAttribution: true,
        requireCanonicalLinks: true,
      },
    },
  };
}

/** A working set of stub runners; override individual hooks per test. */
function makeRunners(
  over: Partial<StageRunners> = {},
  opts: { aggWarnings?: string[] } = {},
): {
  runners: StageRunners;
  calls: { aggregate: number; publish: number; published: CyclePublishSet | null };
} {
  const calls = { aggregate: 0, publish: 0, published: null as CyclePublishSet | null };
  const ranking = makeRanking({
    ai: [makeCluster({ clusterId: 'a1', topic: 'ai', score: makeScore(5) })],
  });
  const runners: StageRunners = {
    aggregate: async (cycle) => {
      calls.aggregate += 1;
      return makeAggregation({ ai: [] }, { cycle, warnings: opts.aggWarnings ?? [] });
    },
    rank: async (): Promise<RankingArtifact> => ranking,
    synthesize: async (top10: Top10Artifact, _agg: AggregationArtifact) => makeArticles(top10),
    publish: async (set) => {
      calls.publish += 1;
      calls.published = set;
    },
    loadPreviousTop10: async () => null,
    ...over,
  };
  return { runners, calls };
}

const NOW = new Date('2026-06-11T08:30:00Z'); // inside the 06:00Z cycle

test('happy path publishes and returns status=published', async () => {
  const { runners, calls } = makeRunners();
  // size:1 fills the one-cluster board, so there is no under-fill coverage warning.
  const res = await runCycle(runners, { now: NOW, selection: { size: 1 } });
  assert.equal(res.status, 'published');
  assert.equal(res.cycle.id, CYCLE.id);
  assert.equal(res.nextRefreshAt, CYCLE.windowEnd);
  assert.equal(calls.publish, 1);
  assert.ok(calls.published?.top10);
  assert.equal(calls.published?.top10.cycle.id, CYCLE.id);
});

test('upstream warnings produce status=degraded but still publish', async () => {
  const { runners, calls } = makeRunners({}, { aggWarnings: ['source timeout: bloomberg'] });
  const res = await runCycle(runners, { now: NOW });
  assert.equal(res.status, 'degraded');
  assert.equal(calls.publish, 1);
  assert.ok(res.warnings.some((w) => w.includes('source timeout')));
});

test('a thrown stage fails the cycle and publishes nothing (last-good-wins)', async () => {
  const { runners, calls } = makeRunners({
    rank: () => {
      throw new Error('ranking engine exploded');
    },
  });
  const res = await runCycle(runners, { now: NOW });
  assert.equal(res.status, 'failed');
  assert.equal(calls.publish, 0); // nothing published
  assert.ok(res.warnings.some((w) => w.includes('ranking engine exploded')));
});

test('a publish failure also fails the cycle', async () => {
  const { runners, calls } = makeRunners({
    publish: async () => {
      throw new Error('publish target down');
    },
  });
  const res = await runCycle(runners, { now: NOW });
  assert.equal(res.status, 'failed');
  assert.equal(calls.aggregate, 1);
  assert.ok(res.warnings.some((w) => w.includes('publish target down')));
});

test('idempotent re-run: an already-published cycle short-circuits', async () => {
  const existing = {} as Top10Artifact;
  const { runners, calls } = makeRunners({
    loadPublished: async () => existing,
  });
  const res = await runCycle(runners, { now: NOW });
  assert.equal(res.status, 'published');
  assert.equal(calls.aggregate, 0); // did no work
  assert.equal(calls.publish, 0);
  assert.ok(res.warnings.some((w) => w.includes('idempotent')));
});

test('backfill: the cycle is derived from the provided instant', async () => {
  const { runners } = makeRunners();
  const res = await runCycle(runners, { now: new Date('2026-06-10T19:05:00Z') });
  assert.equal(res.cycle.id, '2026-06-10T18:00:00.000Z');
});

test('two runs of the same cycle produce identical published top10 (deterministic)', async () => {
  const a = makeRunners();
  const b = makeRunners();
  await runCycle(a.runners, { now: NOW });
  await runCycle(b.runners, { now: NOW });
  assert.deepEqual(a.calls.published?.top10, b.calls.published?.top10);
});
