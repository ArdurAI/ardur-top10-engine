/**
 * Cycle math — the 6-hour batch window the whole pipeline is keyed on.
 *
 * Cycles are aligned to UTC: windows start at 00:00, 06:00, 12:00, 18:00. The
 * window start is `floor(now, 6h)` computed on the epoch (timezone- and
 * DST-agnostic integer arithmetic — see docs/research-notes.md §3). `cycle.id`
 * is the ISO window-start (minute precision, `Z` suffix), human-readable and
 * lexicographically sortable. Every stage is idempotent per `cycle.id`, so a
 * drifted, retried, or backfilled trigger resolves to the same cycle and is
 * safe to re-run.
 */

import type { CycleMeta } from './contracts.ts';
import { CYCLE_INTERVAL_MS } from './contracts.ts';

export { CYCLE_INTERVAL_MS };

/**
 * Format an epoch instant as a stable cycle id: `YYYY-MM-DDTHH:mmZ` (UTC,
 * minute precision). Derived from the ISO string so it is deterministic and
 * sorts chronologically as a plain string.
 */
function cycleId(epochMs: number): string {
  // toISOString() is always UTC: "2026-06-11T06:00:00.000Z".
  // Trim to minute precision and re-append the zone marker.
  return new Date(epochMs).toISOString().slice(0, 16) + 'Z';
}

/** Floor an epoch instant to the start of its 6-hour UTC window. */
function floorToWindow(epochMs: number): number {
  // Math.floor over the interval handles negative epochs (pre-1970) correctly,
  // unlike a bitwise/`%`-then-subtract on a possibly-negative remainder.
  return Math.floor(epochMs / CYCLE_INTERVAL_MS) * CYCLE_INTERVAL_MS;
}

/** Build a {@link CycleMeta} from a window-start epoch instant. */
function cycleFromStart(windowStartMs: number): CycleMeta {
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
export function cycleFor(now: Date): CycleMeta {
  const epochMs = now.getTime();
  if (Number.isNaN(epochMs)) {
    throw new TypeError('cycleFor: `now` is an invalid Date');
  }
  return cycleFromStart(floorToWindow(epochMs));
}

/** The cycle immediately before the given one (its window shifted back 6h). */
export function previousCycle(cycle: CycleMeta): CycleMeta {
  const startMs = Date.parse(cycle.windowStart);
  if (Number.isNaN(startMs)) {
    throw new TypeError(`previousCycle: invalid windowStart "${cycle.windowStart}"`);
  }
  return cycleFromStart(startMs - CYCLE_INTERVAL_MS);
}

/** The cycle immediately after the given one (its window shifted forward 6h). */
export function nextCycle(cycle: CycleMeta): CycleMeta {
  const startMs = Date.parse(cycle.windowStart);
  if (Number.isNaN(startMs)) {
    throw new TypeError(`nextCycle: invalid windowStart "${cycle.windowStart}"`);
  }
  return cycleFromStart(startMs + CYCLE_INTERVAL_MS);
}

/** ISO timestamp of the next refresh (windowEnd of the current cycle). */
export function nextRefreshAt(cycle: CycleMeta): string {
  return cycle.windowEnd;
}
