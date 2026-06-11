import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDelta, computeStability } from './stability.ts';
import { selectTop10 } from './select.ts';
import { makeCluster, makeRanking, makeScore, makeTop10, makeTop10Entry } from './fixtures.ts';
import type { RankedCluster, Top10Entry } from './contracts.ts';

const prevBoard: Top10Entry[] = [
  makeTop10Entry({ clusterId: 'a', rank: 1 }),
  makeTop10Entry({ clusterId: 'b', rank: 2 }),
];

test('computeDelta classifies new / up / down / same', () => {
  assert.deepEqual(computeDelta({ clusterId: 'z', rank: 1 }, prevBoard), {
    previousRank: null,
    movement: 'new',
  });
  assert.deepEqual(computeDelta({ clusterId: 'b', rank: 1 }, prevBoard), {
    previousRank: 2,
    movement: 'up',
  });
  assert.deepEqual(computeDelta({ clusterId: 'a', rank: 3 }, prevBoard), {
    previousRank: 1,
    movement: 'down',
  });
  assert.deepEqual(computeDelta({ clusterId: 'a', rank: 1 }, prevBoard), {
    previousRank: 1,
    movement: 'same',
  });
  assert.deepEqual(computeDelta({ clusterId: 'a', rank: 1 }, null), {
    previousRank: null,
    movement: 'new',
  });
});

test('computeStability: carriedOver + fresh === size and churnRate in [0,1]', () => {
  const current: Top10Entry[] = [
    makeTop10Entry({ clusterId: 'a', rank: 1 }), // carried
    makeTop10Entry({ clusterId: 'c', rank: 2 }), // fresh
  ];
  const s = computeStability(current, prevBoard);
  assert.equal(s.carriedOver, 1);
  assert.equal(s.fresh, 1);
  assert.equal(s.carriedOver + s.fresh, current.length);
  assert.ok(s.churnRate >= 0 && s.churnRate <= 1);
  assert.equal(s.churnRate, 0.5); // b (1 of 2 prev slots) was replaced
});

test('computeStability with no previous board reports zero churn, all fresh', () => {
  const current: Top10Entry[] = [makeTop10Entry({ clusterId: 'a', rank: 1 })];
  const s = computeStability(current, null);
  assert.deepEqual(s, { carriedOver: 0, fresh: 1, churnRate: 0 });
});

test('stabilityMargin hysteresis demonstrably reduces churn vs a naive re-rank', () => {
  const a = makeCluster({ clusterId: 'a', topic: 'ai', score: makeScore(5.0) });
  const b = makeCluster({ clusterId: 'b', topic: 'ai', score: makeScore(4.9) });
  const c = makeCluster({ clusterId: 'c', topic: 'ai', score: makeScore(5.1) });
  const ranking = makeRanking({ ai: [a, b, c] as RankedCluster[] });
  const previous = makeTop10([
    makeTop10Entry({ clusterId: 'a', rank: 1 }),
    makeTop10Entry({ clusterId: 'b', rank: 2 }),
  ]);

  const naive = selectTop10(ranking, previous, { size: 2, stabilityMargin: 0 });
  const sticky = selectTop10(ranking, previous, { size: 2, stabilityMargin: 0.5 });

  // Naive: challenger c (5.1) bumps incumbent b (4.9) -> churn.
  assert.equal(naive.data.stability.churnRate, 0.5);
  assert.deepEqual(naive.data.global.map((e) => e.clusterId).sort(), ['a', 'c']);

  // Sticky: b's incumbency keeps it; c (only 0.2 above b) waits a cycle -> no churn.
  assert.equal(sticky.data.stability.churnRate, 0);
  assert.deepEqual(sticky.data.global.map((e) => e.clusterId).sort(), ['a', 'b']);

  // Ordering within the sticky board is still honest (by real score: a 5.0 > b 4.9).
  assert.deepEqual(
    sticky.data.global.map((e) => e.clusterId),
    ['a', 'b'],
  );
  assert.ok(sticky.data.stability.churnRate < naive.data.stability.churnRate);
});
