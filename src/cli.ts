/**
 * CLI — read a RankingArtifact (+ optional previous Top10Artifact), select the
 * Top-10, write a Top10Artifact to stdout.
 *
 * SCAFFOLD ONLY. Usage (once implemented):
 *   node --experimental-strip-types src/cli.ts ranking.json [previous-top10.json] > top10.json
 */

import { readFileSync } from 'node:fs';
import { selectTop10 } from './select.ts';
import type { RankingArtifact, Top10Artifact } from './contracts.ts';

function main(): void {
  const rankingPath = process.argv[2];
  const previousPath = process.argv[3];
  if (!rankingPath) throw new Error('usage: cli.ts <ranking.json> [previous-top10.json]');

  const ranking = JSON.parse(readFileSync(rankingPath, 'utf8')) as RankingArtifact;
  const previous = previousPath
    ? (JSON.parse(readFileSync(previousPath, 'utf8')) as Top10Artifact)
    : null;

  const top10 = selectTop10(ranking, previous);
  process.stdout.write(JSON.stringify(top10, null, 2));
}

main();
