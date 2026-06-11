/**
 * CLI integration tests — agent-readiness: uniform flags, --describe, JSON errors,
 * stdin, and cycle-id alignment (issue #12).
 *
 * These tests invoke cli.ts via Node child_process so they exercise the real
 * CLI surface, not the underlying selectTop10 function directly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION, CONTRACT_REVISION } from '@ardurai/contracts';
import { makeRanking, makeCluster, makeScore, makeAggregation, makeItem } from './fixtures.ts';

const CLI = new URL('./cli.ts', import.meta.url).pathname;
const NODE = process.execPath;
const NODE_ARGS = ['--experimental-strip-types'];

function runCli(
  args: string[],
  stdin?: string,
): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(NODE, [...NODE_ARGS, CLI, ...args], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env },
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

function writeTmp(dir: string, name: string, data: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  return p;
}

// ---------------------------------------------------------------------------
// --describe
// ---------------------------------------------------------------------------

test('--describe emits valid JSON with required fields', () => {
  const { stdout, status } = runCli(['--describe']);
  assert.equal(status, 0);
  const desc = JSON.parse(stdout) as Record<string, unknown>;
  assert.equal(desc.name, 'ardur-top10-engine');
  assert.equal(desc.stage, 'top10');
  assert.deepEqual(desc.contract, {
    schemaVersion: SCHEMA_VERSION,
    contractRevision: CONTRACT_REVISION,
  });
  assert.ok(desc.input, 'input schema present');
  assert.ok(desc.output, 'output schema present');
  assert.ok(Array.isArray(desc.flags), 'flags array present');
});

test('--describe input schema marks ranking as required', () => {
  const { stdout } = runCli(['--describe']);
  const desc = JSON.parse(stdout) as { input: { required?: string[] } };
  assert.ok(Array.isArray(desc.input.required));
  assert.ok(desc.input.required.includes('ranking'));
});

test('--describe flags list contains all uniform flags', () => {
  const { stdout } = runCli(['--describe']);
  const desc = JSON.parse(stdout) as { flags: Array<{ name: string }> };
  const names = desc.flags.map((f) => f.name);
  for (const flag of [
    '--ranking',
    '--previous',
    '--aggregation',
    '--now',
    '--run-id',
    '--provider',
    '--out',
    '--json-errors',
    '--describe',
  ]) {
    assert.ok(names.includes(flag), `flag ${flag} present`);
  }
});

// ---------------------------------------------------------------------------
// Named flags + basic selection
// ---------------------------------------------------------------------------

test('--ranking <file> produces a valid Top10Artifact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'top10-cli-test-'));
  try {
    const ranking = makeRanking({
      ai: [makeCluster({ clusterId: 'a1', topic: 'ai', score: makeScore(9) })],
    });
    const rankPath = writeTmp(dir, 'ranking.json', ranking);

    const { stdout, status } = runCli(['--ranking', rankPath]);
    assert.equal(status, 0);
    const out = JSON.parse(stdout) as Record<string, unknown>;
    assert.equal(out.artifact, 'top10');
    assert.equal(out.schemaVersion, SCHEMA_VERSION);
    assert.equal(out.contractRevision, CONTRACT_REVISION);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('--ranking - reads ranking from stdin', () => {
  const ranking = makeRanking({
    ai: [makeCluster({ clusterId: 'b1', topic: 'ai', score: makeScore(5) })],
  });
  const { stdout, status } = runCli(['--ranking', '-'], JSON.stringify(ranking));
  assert.equal(status, 0, 'exit 0');
  const out = JSON.parse(stdout) as Record<string, unknown>;
  assert.equal(out.artifact, 'top10');
});

test('--now overrides generatedAt in the output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'top10-cli-test-'));
  try {
    const ranking = makeRanking({ ai: [makeCluster({ clusterId: 'c1', score: makeScore(3) })] });
    const rankPath = writeTmp(dir, 'ranking.json', ranking);
    const nowVal = '2026-06-11T07:00:00.000Z';

    const { stdout, status } = runCli(['--ranking', rankPath, '--now', nowVal]);
    assert.equal(status, 0);
    const out = JSON.parse(stdout) as Record<string, unknown>;
    assert.equal(out.generatedAt, nowVal);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('--run-id stamps the explicit run ID', () => {
  const dir = mkdtempSync(join(tmpdir(), 'top10-cli-test-'));
  try {
    const ranking = makeRanking({ ai: [makeCluster({ clusterId: 'd1', score: makeScore(2) })] });
    const rankPath = writeTmp(dir, 'ranking.json', ranking);

    const { stdout, status } = runCli(['--ranking', rankPath, '--run-id', 'my-custom-run-001']);
    assert.equal(status, 0);
    const out = JSON.parse(stdout) as Record<string, unknown>;
    assert.equal(out.runId, 'my-custom-run-001');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('--out writes artifact to file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'top10-cli-test-'));
  try {
    const ranking = makeRanking({ ai: [makeCluster({ clusterId: 'e1', score: makeScore(1) })] });
    const rankPath = writeTmp(dir, 'ranking.json', ranking);
    const outPath = join(dir, 'top10.json');

    const { stdout, status } = runCli(['--ranking', rankPath, '--out', outPath]);
    assert.equal(status, 0);
    assert.equal(stdout, '', 'nothing on stdout when --out is a file');

    const written = JSON.parse(readFileSync(outPath, 'utf8')) as Record<string, unknown>;
    assert.equal(written.artifact, 'top10');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// contractRevision stamped
// ---------------------------------------------------------------------------

test('output includes contractRevision stamped from @ardurai/contracts', () => {
  const ranking = makeRanking({ ai: [makeCluster({ clusterId: 'f1', score: makeScore(4) })] });
  const { stdout, status } = runCli(['--ranking', '-'], JSON.stringify(ranking));
  assert.equal(status, 0);
  const out = JSON.parse(stdout) as Record<string, unknown>;
  assert.equal(out.contractRevision, CONTRACT_REVISION);
});

// ---------------------------------------------------------------------------
// cycle-id precision alignment
// ---------------------------------------------------------------------------

test('output cycle.id is full ISO 8601 UTC with milliseconds', () => {
  const ranking = makeRanking({ ai: [makeCluster({ clusterId: 'g1', score: makeScore(6) })] });
  const { stdout, status } = runCli(['--ranking', '-'], JSON.stringify(ranking));
  assert.equal(status, 0);
  const out = JSON.parse(stdout) as { cycle: { id: string } };
  assert.match(
    out.cycle.id,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    'full ISO 8601 with ms',
  );
});

// ---------------------------------------------------------------------------
// JSON error envelope (--json-errors)
// ---------------------------------------------------------------------------

test('missing --ranking exits 1 without --json-errors', () => {
  const { status, stderr } = runCli([]);
  assert.equal(status, 1);
  assert.ok(stderr.includes('USAGE_ERROR') || stderr.includes('--ranking'), 'stderr has hint');
});

test('--json-errors: missing --ranking emits JSON error to stdout + exits 1', () => {
  const { stdout, status } = runCli(['--json-errors']);
  assert.equal(status, 1);
  const env = JSON.parse(stdout) as { error: { code: string; stage: string } };
  assert.equal(env.error.code, 'USAGE_ERROR');
});

test('--json-errors: invalid JSON input emits PARSE_ERROR + exits 2', () => {
  const { stdout, status } = runCli(['--ranking', '-', '--json-errors'], 'not-json');
  assert.equal(status, 2);
  const env = JSON.parse(stdout) as { error: { code: string } };
  assert.equal(env.error.code, 'PARSE_ERROR');
});

test('--json-errors: wrong artifact stage emits VALIDATION_ERROR + exits 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'top10-cli-test-'));
  try {
    // Pass an aggregation artifact where a ranking is expected
    const wrongArtifact = makeAggregation({ ai: [makeItem({ id: 'x1' })] });
    const wrongPath = writeTmp(dir, 'wrong.json', wrongArtifact);

    const { stdout, status } = runCli(['--ranking', wrongPath, '--json-errors']);
    assert.equal(status, 2);
    const env = JSON.parse(stdout) as { error: { code: string; stage: string } };
    assert.equal(env.error.code, 'VALIDATION_ERROR');
    assert.ok(env.error.stage.includes('ranking'), `stage field: ${env.error.stage}`);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Deterministic output (same inputs => byte-identical)
// ---------------------------------------------------------------------------

test('same inputs + --now + --run-id produce byte-identical output', () => {
  const ranking = makeRanking({
    ai: [
      makeCluster({ clusterId: 'h1', score: makeScore(8), topic: 'ai' }),
      makeCluster({ clusterId: 'h2', score: makeScore(7), topic: 'ai' }),
    ],
  });
  const stdinData = JSON.stringify(ranking);

  const run = () =>
    runCli(
      ['--ranking', '-', '--now', '2026-06-11T07:00:00.000Z', '--run-id', 'determinism-test'],
      stdinData,
    );

  const a = run();
  const b = run();
  assert.equal(a.status, 0);
  assert.equal(b.status, 0);
  assert.equal(a.stdout, b.stdout, 'byte-identical on identical inputs');
});

// ---------------------------------------------------------------------------
// --provider flag passes through
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Zod Tier-2 structural gate (contracts #2)
// ---------------------------------------------------------------------------

test('--json-errors: NaN score.total (serialised as null) triggers VALIDATION_ERROR at input boundary', () => {
  // NaN is not valid JSON; JSON.stringify silently converts it to null.
  // The Zod gate must catch null where z.number().finite() is required.
  const dir = mkdtempSync(join(tmpdir(), 'top10-cli-test-'));
  try {
    const ranking = makeRanking({
      ai: [makeCluster({ clusterId: 'nan-z', score: makeScore(NaN) })],
    });
    // writeTmp calls JSON.stringify → NaN becomes null in the file
    const badPath = writeTmp(dir, 'ranking-nan.json', ranking);

    const { stdout, status } = runCli(['--ranking', badPath, '--json-errors']);
    assert.equal(status, 2);
    const env = JSON.parse(stdout) as { error: { code: string } };
    assert.equal(env.error.code, 'VALIDATION_ERROR');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('--provider is accepted without error', () => {
  const ranking = makeRanking({ ai: [makeCluster({ clusterId: 'i1', score: makeScore(1) })] });
  const { status } = runCli(
    ['--ranking', '-', '--provider', 'deterministic'],
    JSON.stringify(ranking),
  );
  assert.equal(status, 0);
});
