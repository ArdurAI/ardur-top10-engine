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
import type { RankedCluster } from './contracts.ts';

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
  assert.equal(out.runId, 'top10:2026-06-11T06:00Z');
  assert.equal(out.upstreamRunId, ranking.runId);
  assert.equal(out.generatedAt, ranking.generatedAt); // deterministic, inherited
  assert.equal(out.data.nextRefreshAt, CYCLE.windowEnd);
});

test('references are populated when aggregation is provided, else warned + empty', () => {
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
  const ranking = makeRanking({ ai: [ai('a1', 5, { memberIds: ['m1', 'm2'] })] });

  const withAgg = selectTop10(ranking, null, { aggregation: makeAggregation({ ai: items }) });
  assert.equal(withAgg.data.global[0]?.references.length, 2);
  assert.ok(!withAgg.warnings.some((w) => w.includes('references omitted')));

  const without = selectTop10(ranking, null);
  assert.deepEqual(without.data.global[0]?.references, []);
  assert.ok(without.warnings.some((w) => w.includes('references omitted')));
});

// ── Issue #8: schemaVersion gate + structural validation ──────────────────────

test('selectTop10 throws a clear error on wrong schemaVersion', () => {
  const ranking = makeRanking({ ai: [] });
  const bad = { ...ranking, schemaVersion: 'ardur-content-pipeline/v0' };
  assert.throws(
    () => selectTop10(bad as unknown as typeof ranking, null),
    /schema mismatch/,
  );
});

test('selectTop10 throws when schemaVersion is missing entirely', () => {
  const ranking = makeRanking({ ai: [] });
  const bad = { ...ranking } as Record<string, unknown>;
  delete bad['schemaVersion'];
  assert.throws(
    () => selectTop10(bad as unknown as typeof ranking, null),
    /schema mismatch/,
  );
});

test('selectTop10 throws on wrong artifact type', () => {
  const ranking = makeRanking({ ai: [] });
  const bad = { ...ranking, artifact: 'aggregation' };
  assert.throws(
    () => selectTop10(bad as unknown as typeof ranking, null),
    /malformed/,
  );
});

test('selectTop10 throws when data.rankedByTopic is missing', () => {
  const ranking = makeRanking({ ai: [] });
  const bad = { ...ranking, data: { ...ranking.data, rankedByTopic: null } };
  assert.throws(
    () => selectTop10(bad as unknown as typeof ranking, null),
    /malformed/,
  );
});

// ── Issue #9: unionByCluster stable tie-break across topic key order ───────────

test('unionByCluster: global board is byte-identical regardless of topic key insertion order', () => {
  // Cluster "dup" appears in both topics with identical scores.  The winner
  // must be the same (lexicographically smaller topic key) no matter which
  // topic key appears first in the object literal.
  const makeC = (topic: string) =>
    makeCluster({ clusterId: 'dup', topic, topicLabel: topic, score: makeScore(5) });

  const ab = selectTop10(makeRanking({ alpha: [makeC('alpha')], beta: [makeC('beta')] }), null, { size: 10 });
  const ba = selectTop10(makeRanking({ beta: [makeC('beta')], alpha: [makeC('alpha')] }), null, { size: 10 });

  assert.equal(ab.data.global.length, 1);
  assert.equal(ba.data.global.length, 1);
  // Both orderings produce the same topic winner (alpha < beta lexicographically).
  assert.equal(ab.data.global[0]?.topic, 'alpha');
  assert.equal(ba.data.global[0]?.topic, 'alpha');
});

test('unionByCluster: non-tied clusters are still resolved by compareClusters', () => {
  // Cluster "dup" in beta has a higher score — beta's copy should win regardless.
  const weak = makeCluster({ clusterId: 'dup', topic: 'alpha', topicLabel: 'Alpha', score: makeScore(3) });
  const strong = makeCluster({ clusterId: 'dup', topic: 'beta', topicLabel: 'Beta', score: makeScore(7) });

  const ab = selectTop10(makeRanking({ alpha: [weak], beta: [strong] }), null, { size: 10 });
  const ba = selectTop10(makeRanking({ beta: [strong], alpha: [weak] }), null, { size: 10 });

  assert.equal(ab.data.global[0]?.topic, 'beta');
  assert.equal(ba.data.global[0]?.topic, 'beta');
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
