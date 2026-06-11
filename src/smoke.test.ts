import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, CYCLE_INTERVAL_MS } from './contracts.ts';
import { selectTop10, runCycle, cycleFor } from './index.ts';
import { makeRanking, makeCluster, makeScore } from './fixtures.ts';

test('schema version is pinned', () => {
  assert.equal(SCHEMA_VERSION, 'ardur-content-pipeline/v1');
});

test('cycle interval is 6 hours', () => {
  assert.equal(CYCLE_INTERVAL_MS, 6 * 60 * 60 * 1000);
});

test('public surface is wired and runnable end to end', () => {
  const c = cycleFor(new Date('2026-06-11T06:00:00Z'));
  assert.equal(c.id, '2026-06-11T06:00Z');

  const ranking = makeRanking({
    ai: [makeCluster({ clusterId: 'a1', topic: 'ai', score: makeScore(5) })],
  });
  const top10 = selectTop10(ranking, null);
  assert.equal(top10.artifact, 'top10');
  assert.equal(top10.data.global.length, 1);

  assert.equal(typeof runCycle, 'function');
});
