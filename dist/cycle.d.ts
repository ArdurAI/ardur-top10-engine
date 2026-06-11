/**
 * Cycle math — the 6-hour batch window the whole pipeline is keyed on.
 *
 * Cycles are aligned to UTC: windows start at 00:00, 06:00, 12:00, 18:00. The
 * window start is `floor(now, 6h)` computed on the epoch (timezone- and
 * DST-agnostic integer arithmetic — see docs/research-notes.md §3). `cycle.id`
 * is the full ISO 8601 UTC window-start (e.g. `2026-06-11T06:00:00.000Z`),
 * matching ardur-pipeline's canonical wire format exactly. Every stage is
 * idempotent per `cycle.id`, so a
 * drifted, retried, or backfilled trigger resolves to the same cycle and is
 * safe to re-run.
 */
import type { CycleMeta } from '@ardurai/contracts';
import { CYCLE_INTERVAL_MS } from '@ardurai/contracts';
export { CYCLE_INTERVAL_MS };
/**
 * The cycle containing `now` (window start floored to the 6h boundary, UTC).
 *
 * Pure and deterministic: the same instant always yields the same cycle, and any
 * instant within a window yields that window's cycle. Throws on an invalid Date
 * so a bad clock surfaces loudly rather than producing a garbage `cycle.id`.
 */
export declare function cycleFor(now: Date): CycleMeta;
/** The cycle immediately before the given one (its window shifted back 6h). */
export declare function previousCycle(cycle: CycleMeta): CycleMeta;
/** The cycle immediately after the given one (its window shifted forward 6h). */
export declare function nextCycle(cycle: CycleMeta): CycleMeta;
/** ISO timestamp of the next refresh (windowEnd of the current cycle). */
export declare function nextRefreshAt(cycle: CycleMeta): string;
