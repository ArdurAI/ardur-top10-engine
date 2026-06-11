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
import { assertCompatibleArtifact } from '@ardurai/contracts';
import type {
  RankingArtifact,
  Top10Artifact,
  AggregationArtifact,
  PipelineStage,
} from '@ardurai/contracts';

function readJson(path: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${path}: expected a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
    );
  }
  return parsed;
}

function loadArtifact<TStage extends PipelineStage>(
  path: string,
  stage: TStage,
): ReturnType<typeof assertCompatibleArtifact<TStage>>['envelope'] {
  const raw = readJson(path);
  const { envelope, warnings } = assertCompatibleArtifact(raw, stage);
  for (const w of warnings) process.stderr.write(`[warn] ${path}: ${w}\n`);
  return envelope;
}

function main(): void {
  const rankingPath = process.argv[2];
  const previousPath = process.argv[3];
  const aggregationPath = process.argv[4];
  if (!rankingPath) {
    throw new Error('usage: cli.ts <ranking.json> [previous-top10.json] [aggregation.json]');
  }

  const ranking = loadArtifact(rankingPath, 'ranking') as unknown as RankingArtifact;

  let previous: Top10Artifact | null = null;
  if (previousPath && previousPath !== '-') {
    previous = loadArtifact(previousPath, 'top10') as unknown as Top10Artifact;
  }

  let aggregation: AggregationArtifact | undefined;
  if (aggregationPath) {
    aggregation = loadArtifact(aggregationPath, 'aggregation') as unknown as AggregationArtifact;
  }

  const top10 = selectTop10(ranking, previous, aggregation ? { aggregation } : {});
  process.stdout.write(JSON.stringify(top10, null, 2) + '\n');
}

main();
