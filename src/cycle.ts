/**
 * Cycle math — the 6-hour batch window the whole pipeline is keyed on.
 *
 * SCAFFOLD ONLY. Cycles are aligned to UTC: windows start at 00:00, 06:00,
 * 12:00, 18:00. `cycle.id` is the ISO window-start. Every stage is idempotent
 * per `cycle.id`, so a failed cycle is safe to re-run.
 */

import type { CycleMeta } from './contracts.ts';
import { CYCLE_INTERVAL_MS } from './contracts.ts';

export { CYCLE_INTERVAL_MS };

/** The cycle containing `now` (window start floored to the 6h boundary, UTC). */
export function cycleFor(_now: Date): CycleMeta {
  throw new Error('not implemented: floor(now, 6h) UTC -> {id, windowStart, windowEnd}');
}

/** The cycle immediately before the given one. */
export function previousCycle(_cycle: CycleMeta): CycleMeta {
  throw new Error('not implemented');
}

/** ISO timestamp of the next refresh (windowEnd of the current cycle). */
export function nextRefreshAt(_cycle: CycleMeta): string {
  throw new Error('not implemented');
}
