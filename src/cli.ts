/**
 * CLI — agent-ready entrypoint for the top-10 selection engine.
 *
 * Usage:
 *   node --experimental-strip-types src/cli.ts --describe
 *   node --experimental-strip-types src/cli.ts \
 *     --ranking <file|->  \
 *     [--previous <file|->]  \
 *     [--aggregation <file|->]  \
 *     [--now <iso8601>]  \
 *     [--run-id <id>]  \
 *     [--provider <deterministic|ollama|openai>]  \
 *     [--out <file|->]  \
 *     [--json-errors]
 *
 * Flags:
 *   --ranking      Required. Path to RankingArtifact JSON, or '-' for stdin.
 *   --previous     Optional. Path to previous Top10Artifact JSON, or '-'.
 *   --aggregation  Optional. Path to AggregationArtifact JSON (for references).
 *   --now          ISO-8601 timestamp. Sets `generatedAt` on the output artifact.
 *                  Cycle IDs come from the ranking input, not from this engine.
 *   --run-id       Explicit run ID to stamp on the output artifact.
 *   --provider     Provider hint stamped in output.provider.provider.
 *                  Default: 'deterministic'.
 *   --out          Output path or '-' for stdout (default).
 *   --json-errors  Emit structured JSON error envelopes to stdout + stderr
 *                  instead of plain text. Exit codes are unchanged.
 *   --describe     Print this engine's input/output JSON Schema and exit.
 *
 * Exit codes:
 *   0  success
 *   1  usage / argument error
 *   2  input parse or schema-validation error
 *   3  selection logic error
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { selectTop10 } from './select.ts';
import { assertCompatibleArtifact, SCHEMA_VERSION, CONTRACT_REVISION } from '@ardurai/contracts';
import {
  parseRankingArtifact,
  parseTop10Artifact,
  parseAggregationArtifact,
} from '@ardurai/contracts/zod';
import type {
  RankingArtifact,
  Top10Artifact,
  AggregationArtifact,
  PipelineStage,
} from '@ardurai/contracts';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  ranking: string | null;
  previous: string | null;
  aggregation: string | null;
  now: string | null;
  runId: string | null;
  provider: string;
  out: string | null;
  jsonErrors: boolean;
  describe: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    ranking: null,
    previous: null,
    aggregation: null,
    now: null,
    runId: null,
    provider: 'deterministic',
    out: null,
    jsonErrors: false,
    describe: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ranking' && argv[i + 1]) {
      args.ranking = argv[++i] ?? null;
    } else if (a === '--previous' && argv[i + 1]) {
      args.previous = argv[++i] ?? null;
    } else if (a === '--aggregation' && argv[i + 1]) {
      args.aggregation = argv[++i] ?? null;
    } else if (a === '--now' && argv[i + 1]) {
      args.now = argv[++i] ?? null;
    } else if (a === '--run-id' && argv[i + 1]) {
      args.runId = argv[++i] ?? null;
    } else if (a === '--provider' && argv[i + 1]) {
      args.provider = argv[++i] ?? 'deterministic';
    } else if (a === '--out' && argv[i + 1]) {
      args.out = argv[++i] ?? null;
    } else if (a === '--json-errors') {
      args.jsonErrors = true;
    } else if (a === '--describe') {
      args.describe = true;
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

type ErrorCode = 'USAGE_ERROR' | 'PARSE_ERROR' | 'VALIDATION_ERROR' | 'SELECTION_ERROR';

interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    stage: string;
    detail?: string;
  };
}

function emitError(
  code: ErrorCode,
  message: string,
  stage: string,
  detail: string | undefined,
  jsonErrors: boolean,
): never {
  const exitCode = code === 'USAGE_ERROR' ? 1 : code === 'SELECTION_ERROR' ? 3 : 2;

  if (jsonErrors) {
    const errObj: ErrorEnvelope['error'] = {
      code,
      message,
      stage,
    };
    if (detail !== undefined) errObj.detail = detail;
    process.stdout.write(JSON.stringify({ error: errObj }) + '\n');
  }

  process.stderr.write(
    `ardur-top10-engine: [${code}] ${stage}: ${message}${detail ? ` — ${detail}` : ''}\n`,
  );
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

function readStdin(): string {
  return readFileSync(0, 'utf8');
}

function readPath(pathOrDash: string, label: string, jsonErrors: boolean): string {
  if (pathOrDash === '-') {
    try {
      return readStdin();
    } catch (e) {
      return emitError(
        'PARSE_ERROR',
        `failed to read stdin for ${label}`,
        `input:${label}`,
        e instanceof Error ? e.message : String(e),
        jsonErrors,
      );
    }
  }
  try {
    return readFileSync(pathOrDash, 'utf8');
  } catch (e) {
    return emitError(
      'PARSE_ERROR',
      `failed to read file for ${label}: ${pathOrDash}`,
      `input:${label}`,
      e instanceof Error ? e.message : String(e),
      jsonErrors,
    );
  }
}

function parseJson(raw: string, label: string, jsonErrors: boolean): unknown {
  try {
    return JSON.parse(raw);
  } catch (e) {
    return emitError(
      'PARSE_ERROR',
      `JSON parse failed for ${label}`,
      `input:${label}`,
      e instanceof Error ? e.message : String(e),
      jsonErrors,
    );
  }
}

// Tier-2 Zod parsers keyed by pipeline stage. Each runs Tier-1 (assertCompatibleArtifact)
// then Zod structural validation — NaN serialised as null, missing required fields, and
// type mismatches are all caught here before reaching selectTop10 (contracts #2).
const STAGE_PARSERS: Partial<Record<PipelineStage, (raw: unknown) => unknown>> = {
  ranking: parseRankingArtifact,
  top10: parseTop10Artifact,
  aggregation: parseAggregationArtifact,
};

function loadArtifact<TStage extends PipelineStage>(
  path: string,
  stage: TStage,
  label: string,
  jsonErrors: boolean,
): ReturnType<typeof assertCompatibleArtifact<TStage>>['envelope'] {
  const raw = readPath(path, label, jsonErrors);
  const parsed = parseJson(raw, label, jsonErrors);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return emitError(
      'VALIDATION_ERROR',
      `expected a JSON object for ${label}`,
      `input:${label}`,
      undefined,
      jsonErrors,
    );
  }

  // Tier-1: envelope validation + forward-compat warnings.
  let result: ReturnType<typeof assertCompatibleArtifact<TStage>>;
  try {
    result = assertCompatibleArtifact(parsed, stage);
  } catch (e) {
    return emitError(
      'VALIDATION_ERROR',
      `schema validation failed for ${label}`,
      `input:${label}`,
      e instanceof Error ? e.message : String(e),
      jsonErrors,
    );
  }

  for (const w of result.warnings) {
    process.stderr.write(`[warn] ${label}: ${w}\n`);
  }

  // Tier-2: Zod structural validation (NaN-as-null, missing fields, type coercions).
  const zodParser = STAGE_PARSERS[stage];
  if (zodParser) {
    try {
      zodParser(parsed);
    } catch (e) {
      return emitError(
        'VALIDATION_ERROR',
        `structural validation failed for ${label}`,
        `input:${label}`,
        e instanceof Error ? e.message : String(e),
        jsonErrors,
      );
    }
  }

  return result.envelope;
}

function writeOutput(content: string, outPath: string | null): void {
  if (!outPath || outPath === '-') {
    process.stdout.write(content);
  } else {
    writeFileSync(outPath, content, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// --describe schema
// ---------------------------------------------------------------------------

function emitDescribe(): void {
  const artifactEnvelopeSchema = {
    type: 'object',
    required: [
      'schemaVersion',
      'artifact',
      'runId',
      'upstreamRunId',
      'generatedAt',
      'cycle',
      'topics',
      'warnings',
      'data',
    ],
    properties: {
      schemaVersion: { type: 'string', const: SCHEMA_VERSION },
      contractRevision: { type: 'integer', maximum: CONTRACT_REVISION },
      artifact: { type: 'string' },
      runId: { type: 'string' },
      upstreamRunId: { type: ['string', 'null'] },
      generatedAt: { type: 'string', format: 'date-time' },
      cycle: {
        type: 'object',
        required: ['id', 'windowStart', 'windowEnd'],
        properties: {
          id: {
            type: 'string',
            description: 'ISO-8601 UTC window start, e.g. 2026-06-11T06:00:00.000Z',
          },
          windowStart: { type: 'string', format: 'date-time' },
          windowEnd: { type: 'string', format: 'date-time' },
        },
      },
      topics: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'label', 'description'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            description: { type: 'string' },
          },
        },
      },
      warnings: { type: 'array', items: { type: 'string' } },
      data: { type: 'object' },
    },
  };

  const describe = {
    name: 'ardur-top10-engine',
    stage: 'top10' as PipelineStage,
    contract: {
      schemaVersion: SCHEMA_VERSION,
      contractRevision: CONTRACT_REVISION,
    },
    input: {
      $schema: 'https://json-schema.org/draft-07/schema#',
      type: 'object',
      required: ['ranking'],
      description: 'Inputs to the top-10 selection stage',
      properties: {
        ranking: {
          description: 'RankingArtifact from ardur-ranking-engine (required)',
          allOf: [artifactEnvelopeSchema, { properties: { artifact: { const: 'ranking' } } }],
        },
        previous: {
          description:
            'Top10Artifact from the previous cycle — used for deltas and stability (optional)',
          allOf: [artifactEnvelopeSchema, { properties: { artifact: { const: 'top10' } } }],
        },
        aggregation: {
          description:
            'AggregationArtifact — provides source references; without it, Top10Entry.references is empty (optional)',
          allOf: [artifactEnvelopeSchema, { properties: { artifact: { const: 'aggregation' } } }],
        },
      },
    },
    output: {
      $schema: 'https://json-schema.org/draft-07/schema#',
      description: 'Top10Artifact emitted by ardur-top10-engine',
      allOf: [
        artifactEnvelopeSchema,
        {
          properties: {
            artifact: { const: 'top10' },
            data: {
              type: 'object',
              required: ['nextRefreshAt', 'topicsCovered', 'top10ByTopic', 'global', 'stability'],
              properties: {
                nextRefreshAt: { type: 'string', format: 'date-time' },
                topicsCovered: { type: 'array', items: { type: 'string' } },
                top10ByTopic: { type: 'object', additionalProperties: { type: 'array' } },
                global: {
                  type: 'array',
                  maxItems: 10,
                  items: {
                    type: 'object',
                    required: [
                      'rank',
                      'clusterId',
                      'topic',
                      'headline',
                      'score',
                      'references',
                      'delta',
                      'carriedOver',
                    ],
                    properties: {
                      rank: { type: 'integer', minimum: 1 },
                      clusterId: { type: 'string' },
                      topic: { type: 'string' },
                      topicLabel: { type: 'string' },
                      headline: { type: 'string' },
                      score: { type: 'object' },
                      references: { type: 'array' },
                      delta: {
                        type: 'object',
                        required: ['previousRank', 'movement'],
                        properties: {
                          previousRank: { type: ['integer', 'null'] },
                          movement: { type: 'string', enum: ['new', 'up', 'down', 'same'] },
                        },
                      },
                      carriedOver: { type: 'boolean' },
                    },
                  },
                },
                stability: {
                  type: 'object',
                  required: ['carriedOver', 'fresh', 'churnRate'],
                  properties: {
                    carriedOver: { type: 'integer' },
                    fresh: { type: 'integer' },
                    churnRate: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      ],
    },
    flags: [
      {
        name: '--ranking',
        type: 'string',
        required: true,
        description: 'Path to RankingArtifact JSON, or - for stdin',
      },
      {
        name: '--previous',
        type: 'string',
        required: false,
        description: 'Path to previous Top10Artifact JSON, or -',
      },
      {
        name: '--aggregation',
        type: 'string',
        required: false,
        description: 'Path to AggregationArtifact JSON, or -',
      },
      {
        name: '--now',
        type: 'string',
        required: false,
        description:
          'ISO-8601 timestamp; sets generatedAt on the output artifact (cycle IDs come from the ranking input)',
      },
      {
        name: '--run-id',
        type: 'string',
        required: false,
        description: 'Explicit run ID for the output artifact',
      },
      {
        name: '--provider',
        type: 'string',
        required: false,
        default: 'deterministic',
        description: 'Provider hint stamped in output.provider.provider',
      },
      {
        name: '--out',
        type: 'string',
        required: false,
        description: 'Output path or - for stdout (default: stdout)',
      },
      {
        name: '--json-errors',
        type: 'boolean',
        required: false,
        description: 'Emit structured JSON error envelopes instead of plain text',
      },
      {
        name: '--describe',
        type: 'boolean',
        required: false,
        description: 'Emit this schema and exit',
      },
    ],
  };

  process.stdout.write(JSON.stringify(describe, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.describe) {
    emitDescribe();
    return;
  }

  if (!args.ranking) {
    emitError(
      'USAGE_ERROR',
      '--ranking <file|-> is required',
      'cli',
      'Usage: cli.ts --ranking <file|-> [--previous <file|->] [--aggregation <file|->] [--now <iso>] [--run-id <id>] [--provider <name>] [--out <file|->] [--json-errors]',
      args.jsonErrors,
    );
  }

  const ranking = loadArtifact(
    args.ranking,
    'ranking',
    'ranking',
    args.jsonErrors,
  ) as unknown as RankingArtifact;

  let previous: Top10Artifact | null = null;
  if (args.previous && args.previous !== '-') {
    previous = loadArtifact(
      args.previous,
      'top10',
      'previous',
      args.jsonErrors,
    ) as unknown as Top10Artifact;
  } else if (args.previous === '-') {
    // '-' for previous means "no previous" (empty stdin sentinel kept for compatibility)
    previous = null;
  }

  let aggregation: AggregationArtifact | undefined;
  if (args.aggregation) {
    aggregation = loadArtifact(
      args.aggregation,
      'aggregation',
      'aggregation',
      args.jsonErrors,
    ) as unknown as AggregationArtifact;
  }

  const selectionOpts: Parameters<typeof selectTop10>[2] = {};
  if (aggregation) selectionOpts.aggregation = aggregation;
  if (args.runId) selectionOpts.runId = args.runId;
  if (args.now) selectionOpts.generatedAt = args.now;

  let top10: Top10Artifact;
  try {
    top10 = selectTop10(ranking, previous, selectionOpts);
  } catch (e) {
    emitError(
      'SELECTION_ERROR',
      'selectTop10 threw unexpectedly',
      'selection',
      e instanceof Error ? e.message : String(e),
      args.jsonErrors,
    );
  }

  writeOutput(JSON.stringify(top10, null, 2) + '\n', args.out);
}

main();
