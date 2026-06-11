import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleFor, previousCycle, nextCycle, nextRefreshAt, CYCLE_INTERVAL_MS } from './cycle.ts';

test('cycleFor floors a mid-window instant to the 6h UTC boundary', () => {
  const c = cycleFor(new Date('2026-06-11T08:30:00Z'));
  assert.equal(c.id, '2026-06-11T06:00Z');
  assert.equal(c.windowStart, '2026-06-11T06:00:00.000Z');
  assert.equal(c.windowEnd, '2026-06-11T12:00:00.000Z');
});

test('cycleFor is exact on a window boundary', () => {
  const c = cycleFor(new Date('2026-06-11T06:00:00.000Z'));
  assert.equal(c.windowStart, '2026-06-11T06:00:00.000Z');
});

test('cycleFor rolls back just before a boundary', () => {
  const c = cycleFor(new Date('2026-06-11T05:59:59.999Z'));
  assert.equal(c.id, '2026-06-11T00:00Z');
  assert.equal(c.windowStart, '2026-06-11T00:00:00.000Z');
});

test('cycleFor produces the four canonical UTC boundaries', () => {
  assert.equal(cycleFor(new Date('2026-06-11T00:00:00Z')).id, '2026-06-11T00:00Z');
  assert.equal(cycleFor(new Date('2026-06-11T06:00:00Z')).id, '2026-06-11T06:00Z');
  assert.equal(cycleFor(new Date('2026-06-11T12:00:00Z')).id, '2026-06-11T12:00Z');
  assert.equal(cycleFor(new Date('2026-06-11T23:59:00Z')).id, '2026-06-11T18:00Z');
});

test('cycleFor handles pre-1970 (negative epoch) without drifting', () => {
  const c = cycleFor(new Date('1969-12-31T21:00:00Z'));
  assert.equal(c.windowStart, '1969-12-31T18:00:00.000Z');
  assert.equal(c.windowEnd, '1970-01-01T00:00:00.000Z');
});

test('cycleFor is idempotent across any instant in the same window', () => {
  const a = cycleFor(new Date('2026-06-11T06:00:00Z'));
  const b = cycleFor(new Date('2026-06-11T11:59:59Z'));
  assert.deepEqual(a, b);
});

test('cycleFor throws on an invalid Date', () => {
  assert.throws(() => cycleFor(new Date('not-a-date')), /invalid Date/);
});

test('previousCycle / nextCycle shift the window by exactly 6h', () => {
  const c = cycleFor(new Date('2026-06-11T06:00:00Z'));
  assert.equal(previousCycle(c).id, '2026-06-11T00:00Z');
  assert.equal(nextCycle(c).id, '2026-06-11T12:00Z');
  // round-trip
  assert.deepEqual(nextCycle(previousCycle(c)), c);
});

test('previousCycle crosses a day boundary correctly', () => {
  const c = cycleFor(new Date('2026-06-11T00:00:00Z'));
  assert.equal(previousCycle(c).id, '2026-06-10T18:00Z');
});

test('nextRefreshAt is the window end', () => {
  const c = cycleFor(new Date('2026-06-11T06:00:00Z'));
  assert.equal(nextRefreshAt(c), c.windowEnd);
  assert.equal(
    new Date(c.windowEnd).getTime() - new Date(c.windowStart).getTime(),
    CYCLE_INTERVAL_MS,
  );
});
