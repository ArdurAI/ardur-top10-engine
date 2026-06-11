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
import { CYCLE_INTERVAL_MS } from '@ardurai/contracts';
export { CYCLE_INTERVAL_MS };
/**
 * Format an epoch instant as a stable cycle id in the canonical wire format:
 * full ISO 8601 UTC with milliseconds (e.g. `2026-06-11T06:00:00.000Z`).
 * Matches ardur-pipeline's format so cross-engine cycle-consistency checks
 * never produce spurious `cycle-mismatch` warnings.
 */
function cycleId(epochMs) {
    return new Date(epochMs).toISOString();
}
/** Floor an epoch instant to the start of its 6-hour UTC window. */
function floorToWindow(epochMs) {
    // Math.floor over the interval handles negative epochs (pre-1970) correctly,
    // unlike a bitwise/`%`-then-subtract on a possibly-negative remainder.
    return Math.floor(epochMs / CYCLE_INTERVAL_MS) * CYCLE_INTERVAL_MS;
}
/** Build a {@link CycleMeta} from a window-start epoch instant. */
function cycleFromStart(windowStartMs) {
    const windowEndMs = windowStartMs + CYCLE_INTERVAL_MS;
    return {
        id: cycleId(windowStartMs),
        windowStart: new Date(windowStartMs).toISOString(),
        windowEnd: new Date(windowEndMs).toISOString(),
    };
}
/**
 * The cycle containing `now` (window start floored to the 6h boundary, UTC).
 *
 * Pure and deterministic: the same instant always yields the same cycle, and any
 * instant within a window yields that window's cycle. Throws on an invalid Date
 * so a bad clock surfaces loudly rather than producing a garbage `cycle.id`.
 */
export function cycleFor(now) {
    const epochMs = now.getTime();
    if (Number.isNaN(epochMs)) {
        throw new TypeError('cycleFor: `now` is an invalid Date');
    }
    return cycleFromStart(floorToWindow(epochMs));
}
/** The cycle immediately before the given one (its window shifted back 6h). */
export function previousCycle(cycle) {
    const startMs = Date.parse(cycle.windowStart);
    if (Number.isNaN(startMs)) {
        throw new TypeError(`previousCycle: invalid windowStart "${cycle.windowStart}"`);
    }
    return cycleFromStart(startMs - CYCLE_INTERVAL_MS);
}
/** The cycle immediately after the given one (its window shifted forward 6h). */
export function nextCycle(cycle) {
    const startMs = Date.parse(cycle.windowStart);
    if (Number.isNaN(startMs)) {
        throw new TypeError(`nextCycle: invalid windowStart "${cycle.windowStart}"`);
    }
    return cycleFromStart(startMs + CYCLE_INTERVAL_MS);
}
/** ISO timestamp of the next refresh (windowEnd of the current cycle). */
export function nextRefreshAt(cycle) {
    return cycle.windowEnd;
}
