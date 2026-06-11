/**
 * Orchestration — drive one full 6-hour pipeline cycle end to end.
 *
 * The conductor for the whole pipeline:
 *   aggregate -> rank -> selectTop10 -> synthesize -> publish.
 *
 * It depends on the other engines only through their JSON artifacts (and/or
 * their CLIs), injected as `StageRunners`, never their internals. Properties:
 *
 *  - **Idempotent per `cycle.id`** — the cycle is derived from `floor(now, 6h)`
 *    UTC, so a drifted/retried/backfilled trigger resolves to the same cycle; an
 *    optional `loadPublished` guard makes a re-fire a cheap no-op.
 *  - **Last-good-wins** — if any stage throws, nothing is published and the
 *    previous cycle stays live. Publishing is all-or-nothing per cycle.
 *  - **Traceable** — `selectTop10` threads `upstreamRunId`/`cycle` through the
 *    Top-10 artifact; the injected runners do the same for their stages.
 *
 * See docs/research-notes.md §1, §2, §4 for the reasoning.
 */
import { fileURLToPath } from 'node:url';
import { cycleFor, nextRefreshAt } from "./cycle.js";
import { selectTop10 } from "./select.js";
export function errMessage(e) {
    if (e instanceof Error)
        return e.message;
    return String(e);
}
/**
 * Run one cycle. The top10-engine owns selection itself (`select.ts`); the other
 * three stages are injected via `runners`. Never throws for an expected pipeline
 * failure — failures surface as `status: 'failed' | 'degraded'` with `warnings`.
 */
export async function runCycle(runners, options = {}) {
    const now = options.now ?? new Date();
    const cycle = cycleFor(now);
    const next = nextRefreshAt(cycle);
    const warnings = [];
    // --- Idempotency: skip a cycle that is already published. --------------------
    if (runners.loadPublished) {
        let existing = null;
        try {
            existing = await runners.loadPublished(cycle);
        }
        catch (e) {
            warnings.push(`loadPublished failed (continuing): ${errMessage(e)}`);
        }
        if (existing) {
            warnings.push('idempotent: cycle already published; skipped');
            return { cycle, status: 'published', warnings, nextRefreshAt: next };
        }
    }
    // --- Previous board for deltas (non-fatal if it fails). ----------------------
    let previous = null;
    try {
        previous = await runners.loadPreviousTop10(cycle);
    }
    catch (e) {
        warnings.push(`loadPreviousTop10 failed (continuing without deltas): ${errMessage(e)}`);
    }
    // --- Drive the stages. Any throw => failed, publish nothing. -----------------
    let aggregation;
    let ranking;
    let top10;
    let articles;
    try {
        aggregation = await runners.aggregate(cycle);
        ranking = await runners.rank(aggregation);
        top10 = selectTop10(ranking, previous, { ...options.selection, aggregation });
        articles = await runners.synthesize(top10, aggregation);
    }
    catch (e) {
        warnings.push(`stage failed: ${errMessage(e)}`);
        return { cycle, status: 'failed', warnings, nextRefreshAt: next };
    }
    // Soft cycle-consistency checks (don't fail the cycle, but flag drift).
    for (const [name, art] of [
        ['aggregation', aggregation],
        ['ranking', ranking],
        ['top10', top10],
    ]) {
        if (art.cycle.id !== cycle.id) {
            warnings.push(`${name} cycle mismatch: expected ${cycle.id}, got ${art.cycle.id}`);
        }
    }
    // Upstream non-fatal warnings classify the published cycle as degraded.
    const upstreamWarnings = [
        ...aggregation.warnings,
        ...ranking.warnings,
        ...top10.warnings,
        ...articles.warnings,
    ];
    // --- Publish all-or-nothing. -------------------------------------------------
    try {
        await runners.publish({ cycle, aggregation, ranking, top10, articles });
    }
    catch (e) {
        warnings.push(`publish failed: ${errMessage(e)}`);
        return { cycle, status: 'failed', warnings, nextRefreshAt: next };
    }
    const allWarnings = [...warnings, ...upstreamWarnings];
    const status = upstreamWarnings.length > 0 ? 'degraded' : 'published';
    return { cycle, status, warnings: allWarnings, nextRefreshAt: next };
}
// ---------------------------------------------------------------------------
// CLI entrypoint — runs only when invoked directly (not imported).
//
// Usage:
//   node --experimental-strip-types src/orchestrate.ts [--now <iso8601>] [--json-errors]
//
// Flags:
//   --now          ISO-8601 timestamp used to derive the cycle (backfill support).
//                  Default: current wall clock.
//   --json-errors  Emit errors as JSON to stdout instead of plain stderr text.
//
// This is a library: full-cycle execution (aggregate→rank→synthesize→publish)
// requires injected StageRunners. Use `ardur-pipeline` for production runs.
// When invoked directly this prints the cycle meta for the given --now value —
// useful for verifying cycle math and debugging backfill targets.
// ---------------------------------------------------------------------------
function cliMain() {
    const argv = process.argv.slice(2);
    let nowArg = null;
    let jsonErrors = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--now' && argv[i + 1]) {
            nowArg = argv[++i] ?? null;
        }
        else if (argv[i] === '--json-errors') {
            jsonErrors = true;
        }
        else if (argv[i] === '--help' || argv[i] === '-h') {
            process.stdout.write('Usage: orchestrate.ts [--now <iso8601>] [--json-errors]\n' +
                '\n' +
                'Prints the CycleMeta derived for the given instant (or now).\n' +
                'Full pipeline execution requires ardur-pipeline with injected runners.\n');
            return;
        }
    }
    let now;
    if (nowArg) {
        now = new Date(nowArg);
        if (Number.isNaN(now.getTime())) {
            const msg = `invalid --now value: "${nowArg}" is not a valid ISO-8601 timestamp`;
            if (jsonErrors) {
                process.stdout.write(JSON.stringify({ error: { code: 'USAGE_ERROR', message: msg, stage: 'cli' } }) + '\n');
            }
            process.stderr.write(`ardur-top10-engine/orchestrate: ${msg}\n`);
            process.exit(1);
        }
    }
    else {
        now = new Date();
    }
    const cycle = cycleFor(now);
    process.stdout.write(JSON.stringify({
        engine: 'ardur-top10-engine',
        mode: 'cycle-info',
        derivedFrom: now.toISOString(),
        cycle,
        nextRefreshAt: nextRefreshAt(cycle),
    }, null, 2) + '\n');
}
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain)
    cliMain();
