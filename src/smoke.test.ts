import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, CYCLE_INTERVAL_MS } from './contracts.ts';
import { selectTop10 } from './select.ts';
import { runCycle } from './orchestrate.ts';

test('schema version is pinned', () => {
  assert.equal(SCHEMA_VERSION, 'ardur-content-pipeline/v1');
});

test('cycle interval is 6 hours', () => {
  assert.equal(CYCLE_INTERVAL_MS, 6 * 60 * 60 * 1000);
});

test('selectTop10 is wired but not yet implemented', () => {
  // @ts-expect-error passing an empty artifact to a stub
  assert.throws(() => selectTop10({}, null), /not implemented/);
});

test('runCycle is wired but not yet implemented', async () => {
  // @ts-expect-error passing empty runners to a stub
  await assert.rejects(async () => runCycle({}), /not implemented/);
});
