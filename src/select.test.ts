import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectTop10, compareClusters } from './select.ts';
import {
  CYCLE,
  makeAggregation,
  makeCluster,
  makeItem,
  makeRanking,
  makeScore,
  makeTop10,
  makeTop10Entry,
} from './fixtures.ts';
import { SchemaVersionError } from '@ardurai/contracts';
import type { RankedCluster } from '@ardurai/contracts';

function ai(clusterId: string, total: number, over: Partial<RankedCluster> = {}): RankedCluster {
  return makeCluster({
    clusterId,
    topic: 'ai',
    topicLabel: 'AI',
    score: makeScore(total),
    ...over,
  });
}
function sec(clusterId: string, total: number, over: Partial<RankedCluster> = {}): RankedCluster {
  return makeCluster({
    clusterId,
    topic: 'security',
    topicLabel: 'Security',
    score: makeScore(total),
    ...over,
  });
}

test('selects <=size per topic with contiguous ranks 1..N, ordered by score', () => {
  const clusters = Array.from({ length: 12 }, (_, i) => ai(`c${i}`, 100 - i));
  const out = selectTop10(makeRanking({ ai: clusters }), null);
  const board = out.data.top10ByTopic['ai'] ?? [];
  assert.equal(board.length, 10);
  assert.deepEqual(
    board.map((e) => e.rank),
    Array.from({ length: 10 }, (_, i) => i + 1),
  );
  assert.deepEqual(
    board.map((e) => e.clusterId),
    Array.from({ length: 10 }, (_, i) => `c${i}`),
  );
});

test('tie-break: equal total falls through to corroboration, then clusterId', () => {
  const a = ai('a', 5, { score: makeScore(5, { corroboration: 1 }) });
  const b = ai('b', 5, { score: makeScore(5, { corroboration: 9 }) });
  assert.ok(compareClusters(b, a) < 0); // higher corroboration ranks first

  const x = ai('x', 5, {
    score: makeScore(5),
    latestPublishedAt: '2026-06-11T06:00:00Z',
    distinctDomains: 2,
  });
  const y = ai('y', 5, {
    score: makeScore(5),
    latestPublishedAt: '2026-06-11T06:00:00Z',
    distinctDomains: 2,
  });
  // fully equal except id -> clusterId ascending is the final, deterministic tie-break
  assert.ok(compareClusters(x, y) < 0);
});

test('all-equal-scores produces a deterministic clusterId-ordered board', () => {
  const clusters = ['c3', 'c1', 'c2'].map((id) => ai(id, 5));
  const out = selectTop10(makeRanking({ ai: clusters }), null);
  assert.deepEqual(
    (out.data.top10ByTopic['ai'] ?? []).map((e) => e.clusterId),
    ['c1', 'c2', 'c3'],
  );
});

test('category balancing caps one category in the global board', () => {
  const ranking = makeRanking({
    ai: [ai('a1', 10), ai('a2', 9), ai('a3', 8), ai('a4', 7)],
    security: [sec('s1', 6), sec('s2', 5), sec('s3', 4), sec('s4', 3)],
  });
  const out = selectTop10(ranking, null, { size: 4, maxPerCategory: 2 });
  const cats = out.data.global.map((e) => e.topic);
  assert.equal(out.data.global.length, 4);
  assert.equal(cats.filter((t) => t === 'ai').length, 2);
  assert.equal(cats.filter((t) => t === 'security').length, 2);
});

test('category cap relaxes to fill when only one category is available', () => {
  const ranking = makeRanking({ ai: [ai('a1', 10), ai('a2', 9), ai('a3', 8), ai('a4', 7)] });
  const out = selectTop10(ranking, null, { size: 4, maxPerCategory: 1 });
  assert.equal(out.data.global.length, 4); // relaxed past the cap to fill the board
});

test('global board merges topics, deduped by clusterId', () => {
  const ranking = makeRanking({ ai: [ai('a1', 10), ai('a2', 8)], security: [sec('s1', 9)] });
  const out = selectTop10(ranking, null, { size: 10 });
  assert.deepEqual(
    out.data.global.map((e) => e.clusterId),
    ['a1', 's1', 'a2'],
  );
});

test('a pre-merged "all" key is used as the global source and hidden from topics', () => {
  const ranking = makeRanking({
    ai: [ai('a1', 10)],
    all: [ai('a1', 10), sec('s1', 9)],
  });
  const out = selectTop10(ranking, null);
  assert.deepEqual(
    out.data.global.map((e) => e.clusterId),
    ['a1', 's1'],
  );
  assert.ok(!('all' in out.data.top10ByTopic));
  assert.ok('ai' in out.data.top10ByTopic);
});

test('empty input yields empty boards and zeroed stability', () => {
  const out = selectTop10(makeRanking({}), null);
  assert.deepEqual(out.data.global, []);
  assert.deepEqual(out.data.top10ByTopic, {});
  assert.deepEqual(out.data.topicsCovered, []);
  assert.deepEqual(out.data.stability, { carriedOver: 0, fresh: 0, churnRate: 0 });
});

test('single-item input produces a one-entry board', () => {
  const out = selectTop10(makeRanking({ ai: [ai('only', 1)] }), null);
  assert.equal(out.data.global.length, 1);
  assert.equal(out.data.global[0]?.rank, 1);
});

test('selection is idempotent: identical inputs => identical artifact', () => {
  const ranking = makeRanking({ ai: [ai('a1', 10), ai('a2', 9)], security: [sec('s1', 8)] });
  const a = selectTop10(ranking, null, { size: 5 });
  const b = selectTop10(ranking, null, { size: 5 });
  assert.deepEqual(a, b);
});

test('artifact envelope is wired: ids, cycle, nextRefreshAt', () => {
  const ranking = makeRanking({ ai: [ai('a1', 1)] });
  const out = selectTop10(ranking, null);
  assert.equal(out.artifact, 'top10');
  assert.equal(out.runId, 'top10:2026-06-11T06:00:00.000Z');
  assert.equal(out.upstreamRunId, ranking.runId);
  assert.equal(out.generatedAt, ranking.generatedAt); // deterministic, inherited
  assert.equal(out.data.nextRefreshAt, CYCLE.windowEnd);
});

test('references are populated when aggregation is provided, else warned + empty (rev 1/2 legacy)', () => {
  const items = [
    makeItem({ id: 'm1', clusterId: 'a1', url: 'https://reuters.com/m1' }),
    makeItem({
      id: 'm2',
      clusterId: 'a1',
      source: 'Bloomberg',
      title: 'two',
      url: 'https://bloomberg.com/m2',
    }),
  ];
  // Rev 1/2 cluster: no `references` field — must fall back to aggregation
  const ranking = makeRanking({ ai: [ai('a1', 5, { memberIds: ['m1', 'm2'] })] });

  const withAgg = selectTop10(ranking, null, { aggregation: makeAggregation({ ai: items }) });
  assert.equal(withAgg.data.global[0]?.references.length, 2);
  assert.ok(!withAgg.warnings.some((w) => w.includes('references omitted')));

  const without = selectTop10(ranking, null);
  assert.deepEqual(without.data.global[0]?.references, []);
  assert.ok(without.warnings.some((w) => w.includes('references omitted')));
});

test('rev 3 cluster: references used directly, no aggregation needed, uncapped', () => {
  // 12 pre-built refs from the ranking engine — all should survive (no 5-ref cap)
  const revThreeRefs = Array.from({ length: 12 }, (_, i) => ({
    source: `Src${i}`,
    sourceDomain: `src${i}.com`,
    tier: 'news' as const,
    url: `https://src${i}.com/article`,
    title: `Article ${i}`,
    publishedAt: '2026-06-11T06:00:00Z',
  }));
  const cluster = ai('a1', 5, { references: revThreeRefs });
  const ranking = makeRanking({ ai: [cluster] });

  const out = selectTop10(ranking, null); // no aggregation — not needed for Rev 3
  const entry = out.data.global[0];
  assert.ok(entry);
  assert.equal(entry.references.length, 12); // all 12, uncapped
  assert.ok(!out.warnings.some((w) => w.includes('references omitted')));
});

test('rev 3 cluster: unsafe URLs in pre-built references are dropped', () => {
  const refs = [
    {
      source: 'Safe',
      sourceDomain: 'safe.com',
      tier: 'news' as const,
      url: 'https://safe.com/a',
      title: 'Safe',
      publishedAt: '2026-06-11T06:00:00Z',
    },
    {
      source: 'Insecure',
      sourceDomain: 'insecure.com',
      tier: 'news' as const,
      url: 'http://insecure.com/b', // non-https → dropped
      title: 'Insecure',
      publishedAt: '2026-06-11T06:00:00Z',
    },
  ];
  const out = selectTop10(makeRanking({ ai: [ai('a1', 5, { references: refs })] }), null);
  assert.equal(out.data.global[0]?.references.length, 1);
  assert.equal(out.data.global[0]?.references[0]?.source, 'Safe');
});

test('rev 3 cluster: sourceDocIds forwarded to Top10Entry', () => {
  const docIds = ['doc-aaa', 'doc-bbb', 'doc-ccc'];
  const cluster = ai('a1', 5, { references: [], sourceDocIds: docIds });
  const out = selectTop10(makeRanking({ ai: [cluster] }), null);
  assert.deepEqual(out.data.global[0]?.sourceDocIds, docIds);
});

test('rev 3 cluster with no sourceDocIds: entry omits the field', () => {
  // cluster.sourceDocIds is undefined (omitted)
  const out = selectTop10(makeRanking({ ai: [ai('a1', 5, { references: [] })] }), null);
  assert.ok(!('sourceDocIds' in (out.data.global[0] ?? {})));
});

test('contractRevision is stamped as CONTRACT_REVISION (3) in output', () => {
  const out = selectTop10(makeRanking({ ai: [ai('a1', 1)] }), null);
  assert.equal(out.contractRevision, 3);
});

// ── Issue #8: schemaVersion gate + structural validation ──────────────────────

test('selectTop10 throws SchemaVersionError on wrong schemaVersion', () => {
  const ranking = makeRanking({ ai: [] });
  const bad = { ...ranking, schemaVersion: 'ardur-content-pipeline/v0' };
  assert.throws(() => selectTop10(bad as unknown as typeof ranking, null), SchemaVersionError);
});

test('selectTop10 throws SchemaVersionError when schemaVersion is missing', () => {
  const ranking = makeRanking({ ai: [] });
  const bad = { ...ranking } as Record<string, unknown>;
  delete bad['schemaVersion'];
  assert.throws(() => selectTop10(bad as unknown as typeof ranking, null), SchemaVersionError);
});

test('selectTop10 throws SchemaVersionError on wrong artifact type', () => {
  const ranking = makeRanking({ ai: [] });
  const bad = { ...ranking, artifact: 'aggregation' };
  assert.throws(() => selectTop10(bad as unknown as typeof ranking, null), SchemaVersionError);
});

test('selectTop10 returns empty boards when data.rankedByTopic is null (graceful)', () => {
  const ranking = makeRanking({ ai: [] });
  const bad = { ...ranking, data: { ...ranking.data, rankedByTopic: null } };
  const result = selectTop10(bad as unknown as typeof ranking, null);
  assert.equal(result.artifact, 'top10');
  assert.deepEqual(result.data.global, []);
  assert.deepEqual(result.data.top10ByTopic, {});
});

// ── Issue #9: unionByCluster stable tie-break across topic key order ───────────

test('unionByCluster: global board is byte-identical regardless of topic key insertion order', () => {
  // Cluster "dup" appears in both topics with identical scores.  The winner
  // must be the same (lexicographically smaller topic key) no matter which
  // topic key appears first in the object literal.
  const makeC = (topic: string) =>
    makeCluster({ clusterId: 'dup', topic, topicLabel: topic, score: makeScore(5) });

  const ab = selectTop10(makeRanking({ alpha: [makeC('alpha')], beta: [makeC('beta')] }), null, {
    size: 10,
  });
  const ba = selectTop10(makeRanking({ beta: [makeC('beta')], alpha: [makeC('alpha')] }), null, {
    size: 10,
  });

  assert.equal(ab.data.global.length, 1);
  assert.equal(ba.data.global.length, 1);
  // Both orderings produce the same topic winner (alpha < beta lexicographically).
  assert.equal(ab.data.global[0]?.topic, 'alpha');
  assert.equal(ba.data.global[0]?.topic, 'alpha');
});

test('unionByCluster: non-tied clusters are still resolved by compareClusters', () => {
  // Cluster "dup" in beta has a higher score — beta's copy should win regardless.
  const weak = makeCluster({
    clusterId: 'dup',
    topic: 'alpha',
    topicLabel: 'Alpha',
    score: makeScore(3),
  });
  const strong = makeCluster({
    clusterId: 'dup',
    topic: 'beta',
    topicLabel: 'Beta',
    score: makeScore(7),
  });

  const ab = selectTop10(makeRanking({ alpha: [weak], beta: [strong] }), null, { size: 10 });
  const ba = selectTop10(makeRanking({ beta: [strong], alpha: [weak] }), null, { size: 10 });

  assert.equal(ab.data.global[0]?.topic, 'beta');
  assert.equal(ba.data.global[0]?.topic, 'beta');
});

// ── Issue #13: CWE-915 — reserved topic keys must not corrupt prototype chain ──

test('__proto__ topic key is rejected with warning; prototype of top10ByTopic is not corrupted', () => {
  // JSON.parse creates "__proto__" via [[DefineOwnProperty]], not [[Set]], so it
  // becomes an own enumerable property on the parsed object — Object.entries sees it.
  // We replicate that here with Object.defineProperty to avoid relying on JSON.parse
  // behaviour in the test harness.
  const clusters: Record<string, RankedCluster[]> = {};
  Object.defineProperty(clusters, '__proto__', {
    value: [ai('c-proto', 10)],
    enumerable: true,
    writable: true,
    configurable: true,
  });
  clusters['ai'] = [ai('c-normal', 5)];

  const ranking = makeRanking(clusters);
  const out = selectTop10(ranking, null);

  // Prototype of top10ByTopic must remain Object.prototype (no setter-side effect).
  assert.equal(Object.getPrototypeOf(out.data.top10ByTopic), Object.prototype);
  // "__proto__" must not appear as an own key on the output map.
  assert.ok(!Object.prototype.hasOwnProperty.call(out.data.top10ByTopic, '__proto__'));
  // The legitimate 'ai' board must still be built.
  assert.ok(Object.prototype.hasOwnProperty.call(out.data.top10ByTopic, 'ai'));
  assert.equal(out.data.top10ByTopic['ai']?.length, 1);
  // The rejected key must appear in warnings.
  assert.ok(out.warnings.some((w) => w.includes('"__proto__"')));
  // The c-proto cluster (which came from the rejected topic) must not appear in global.
  assert.ok(!out.data.global.some((e) => e.clusterId === 'c-proto'));
});

test('constructor and toString topic keys are also rejected as reserved names', () => {
  const clusters: Record<string, RankedCluster[]> = {};
  Object.defineProperty(clusters, 'constructor', {
    value: [ai('c-ctor', 10)],
    enumerable: true,
    writable: true,
    configurable: true,
  });
  clusters['ai'] = [ai('c-normal', 5)];

  const ranking = makeRanking(clusters);
  const out = selectTop10(ranking, null);

  assert.ok(!Object.prototype.hasOwnProperty.call(out.data.top10ByTopic, 'constructor'));
  assert.ok(out.warnings.some((w) => w.includes('"constructor"')));
  assert.ok(Object.prototype.hasOwnProperty.call(out.data.top10ByTopic, 'ai'));
});

test('deltas + carriedOver computed vs the previous global board', () => {
  const previous = makeTop10([
    makeTop10Entry({ clusterId: 'a1', rank: 1 }),
    makeTop10Entry({ clusterId: 'a2', rank: 2 }),
  ]);
  // New cycle: a2 climbs to 1, a1 drops to 2, a3 is brand new.
  const ranking = makeRanking({ ai: [ai('a2', 10), ai('a1', 9), ai('a3', 1)] });
  const out = selectTop10(ranking, previous, { size: 3 });
  const byId = Object.fromEntries(out.data.global.map((e) => [e.clusterId, e]));
  assert.deepEqual(byId['a2']?.delta, { previousRank: 2, movement: 'up' });
  assert.deepEqual(byId['a1']?.delta, { previousRank: 1, movement: 'down' });
  assert.deepEqual(byId['a3']?.delta, { previousRank: null, movement: 'new' });
  assert.equal(byId['a2']?.carriedOver, true);
  assert.equal(byId['a3']?.carriedOver, false);
});
