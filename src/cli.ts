/**
 * CLI — read a RankingArtifact (+ optional previous Top10Artifact + optional
 * AggregationArtifact for references), select the Top-10, write a Top10Artifact
 * to stdout.
 *
 * Usage:
 *   node --experimental-strip-types src/cli.ts ranking.json \
 *     [previous-top10.json] [aggregation.json] > top10.json
 *
 * The aggregation artifact is optional but required for copyright-safe
 * references (it resolves cluster members to source/title/url). Without it the
 * Top-10 is still produced, with empty `references[]` and a warning.
 */

import { readFileSync } from 'node:fs';
import { selectTop10 } from './select.ts';
import { SCHEMA_VERSION } from './contracts.ts';
import type { RankingArtifact, Top10Artifact, AggregationArtifact } from './contracts.ts';

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${path}: expected a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
    );
  }
  return parsed as Record<string, unknown>;
}

function validateEnvelope(
  obj: Record<string, unknown>,
  expectedArtifact: string,
  filePath: string,
): void {
  if (!('schemaVersion' in obj)) {
    throw new Error(
      `${filePath}: missing required field "schemaVersion" — is this an Ardur pipeline artifact?`,
    );
  }
  if (obj['schemaVersion'] !== SCHEMA_VERSION) {
    throw new Error(
      `${filePath}: schema mismatch: expected "${SCHEMA_VERSION}", got "${obj['schemaVersion']}"`,
    );
  }
  if (obj['artifact'] !== expectedArtifact) {
    throw new Error(
      `${filePath}: artifact type mismatch: expected "${expectedArtifact}", got "${obj['artifact']}"`,
    );
  }
  if (typeof obj['data'] !== 'object' || obj['data'] === null) {
    throw new Error(`${filePath}: missing or malformed "data" field`);
  }
}

function main(): void {
  const rankingPath = process.argv[2];
  const previousPath = process.argv[3];
  const aggregationPath = process.argv[4];
  if (!rankingPath) {
    throw new Error('usage: cli.ts <ranking.json> [previous-top10.json] [aggregation.json]');
  }

  const rankingRaw = readJson(rankingPath);
  validateEnvelope(rankingRaw, 'ranking', rankingPath);
  const ranking = rankingRaw as unknown as RankingArtifact;

  let previous: Top10Artifact | null = null;
  if (previousPath && previousPath !== '-') {
    const prevRaw = readJson(previousPath);
    validateEnvelope(prevRaw, 'top10', previousPath);
    previous = prevRaw as unknown as Top10Artifact;
  }

  let aggregation: AggregationArtifact | undefined;
  if (aggregationPath) {
    const aggRaw = readJson(aggregationPath);
    validateEnvelope(aggRaw, 'aggregation', aggregationPath);
    aggregation = aggRaw as unknown as AggregationArtifact;
  }

  const top10 = selectTop10(ranking, previous, aggregation ? { aggregation } : {});
  process.stdout.write(JSON.stringify(top10, null, 2) + '\n');
}

main();
