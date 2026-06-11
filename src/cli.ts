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
import type { RankingArtifact, Top10Artifact, AggregationArtifact } from './contracts.ts';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function main(): void {
  const rankingPath = process.argv[2];
  const previousPath = process.argv[3];
  const aggregationPath = process.argv[4];
  if (!rankingPath) {
    throw new Error('usage: cli.ts <ranking.json> [previous-top10.json] [aggregation.json]');
  }

  const ranking = readJson<RankingArtifact>(rankingPath);
  const previous =
    previousPath && previousPath !== '-' ? readJson<Top10Artifact>(previousPath) : null;
  const aggregation = aggregationPath ? readJson<AggregationArtifact>(aggregationPath) : undefined;

  const top10 = selectTop10(ranking, previous, aggregation ? { aggregation } : {});
  process.stdout.write(JSON.stringify(top10, null, 2) + '\n');
}

main();
