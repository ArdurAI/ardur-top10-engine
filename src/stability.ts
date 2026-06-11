/**
 * Cross-cycle deltas + stability/churn.
 *
 * Diffing is by **stable identity** (`clusterId`), never by array position: an
 * item holding the same rank across two cycles is `same`, one present last cycle
 * is `carriedOver`. This is what lets the board be stable and "what changed?"
 * meaningful across the 6-hour cadence (docs/research-notes.md §5).
 *
 * The `stabilityMargin` hysteresis itself is applied during *selection*
 * (select.ts), which decides membership; this module computes the resulting
 * deltas and the churn report. Pure and deterministic.
 */

import type { Top10Entry, StabilityReport } from '@ardurai/contracts';

/** Index a previous board by `clusterId` for O(1) incumbent lookups. */
export function indexByCluster(
  previous: readonly Top10Entry[] | null | undefined,
): Map<string, Top10Entry> {
  const map = new Map<string, Top10Entry>();
  if (!previous) return map;
  for (const entry of previous) map.set(entry.clusterId, entry);
  return map;
}

/** The set of `clusterId`s that held a slot on the previous board. */
export function incumbentIds(previous: readonly Top10Entry[] | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!previous) return ids;
  for (const entry of previous) ids.add(entry.clusterId);
  return ids;
}

/**
 * Rank movement of one entry vs the previous cycle's board.
 *
 * - not on the previous board ⇒ `{ previousRank: null, movement: 'new' }`
 * - smaller rank number now ⇒ `'up'`; larger ⇒ `'down'`; equal ⇒ `'same'`
 */
export function computeDelta(
  entry: Pick<Top10Entry, 'clusterId' | 'rank'>,
  previous: readonly Top10Entry[] | null,
): Top10Entry['delta'] {
  const prev = indexByCluster(previous).get(entry.clusterId);
  if (!prev) return { previousRank: null, movement: 'new' };
  if (entry.rank < prev.rank) return { previousRank: prev.rank, movement: 'up' };
  if (entry.rank > prev.rank) return { previousRank: prev.rank, movement: 'down' };
  return { previousRank: prev.rank, movement: 'same' };
}

/**
 * Stability/churn for the current board vs the previous one.
 *
 * - `carriedOver` — entries also present last cycle
 * - `fresh` — entries new this cycle (`carriedOver + fresh === current.length`)
 * - `churnRate ∈ [0,1]` — fraction of *previous* slots replaced this cycle; `0`
 *   when there is no previous board (no baseline to churn against).
 */
export function computeStability(
  current: readonly Top10Entry[],
  previous: readonly Top10Entry[] | null,
): StabilityReport {
  const prevIds = incumbentIds(previous);
  let carriedOver = 0;
  for (const entry of current) {
    if (prevIds.has(entry.clusterId)) carriedOver += 1;
  }
  const fresh = current.length - carriedOver;

  let churnRate = 0;
  if (previous && previous.length > 0) {
    const currIds = new Set(current.map((e) => e.clusterId));
    let replaced = 0;
    for (const id of prevIds) {
      if (!currIds.has(id)) replaced += 1;
    }
    churnRate = replaced / previous.length;
  }

  return { carriedOver, fresh, churnRate };
}
