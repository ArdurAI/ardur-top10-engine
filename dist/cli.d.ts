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
 *   --now          ISO-8601 timestamp. Overrides wall-clock for deterministic
 *                  cycle IDs and generatedAt when the ranking doesn't carry one.
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
export {};
