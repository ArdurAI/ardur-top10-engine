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
export declare function indexByCluster(previous: readonly Top10Entry[] | null | undefined): Map<string, Top10Entry>;
/** The set of `clusterId`s that held a slot on the previous board. */
export declare function incumbentIds(previous: readonly Top10Entry[] | null | undefined): Set<string>;
/**
 * Rank movement of one entry vs the previous cycle's board.
 *
 * - not on the previous board ⇒ `{ previousRank: null, movement: 'new' }`
 * - smaller rank number now ⇒ `'up'`; larger ⇒ `'down'`; equal ⇒ `'same'`
 */
export declare function computeDelta(entry: Pick<Top10Entry, 'clusterId' | 'rank'>, previous: readonly Top10Entry[] | null): Top10Entry['delta'];
/**
 * Stability/churn for the current board vs the previous one.
 *
 * - `carriedOver` — entries also present last cycle
 * - `fresh` — entries new this cycle (`carriedOver + fresh === current.length`)
 * - `churnRate ∈ [0,1]` — fraction of *previous* slots replaced this cycle; `0`
 *   when there is no previous board (no baseline to churn against).
 */
export declare function computeStability(current: readonly Top10Entry[], previous: readonly Top10Entry[] | null): StabilityReport;
