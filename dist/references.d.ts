/**
 * Copyright-safe reference assembly.
 *
 * Two paths:
 *   Rev 3 producer: `RankedCluster.references` is pre-built by the ranking engine.
 *     Use `referencesFromCluster()` — applies safePublicUrl for defence-in-depth,
 *     returns the FULL set (display capping is a renderer concern).
 *   Rev 1/2 producer: `RankedCluster` only carries `memberIds`. Resolve against
 *     an `itemsById` map from the same-cycle AggregationArtifact via `referencesFor()`.
 *     When no map is provided references resolve to `[]` rather than leaking partial data.
 */
import type { AggregatedItem, RankedCluster, SourceRef } from '@ardurai/contracts';
/** Default cap on references kept per entry (spec §4). */
export declare const DEFAULT_MAX_REFERENCES = 5;
/** Map from `AggregatedItem.id` to the item, for member resolution. */
export type ItemsById = Readonly<Record<string, AggregatedItem>>;
/** Build an id→item lookup from a flat list of aggregated items. */
export declare function indexItems(items: readonly AggregatedItem[]): Record<string, AggregatedItem>;
/**
 * Rev 3 path: sanitize and pass through pre-built references from `RankedCluster.references`.
 *
 * - applies `safePublicUrl` on each ref URL (defence-in-depth: the ranking engine
 *   should have cleaned them, but we never trust upstream unconditionally)
 * - drops any ref whose URL does not survive the safety check
 * - returns the FULL set — display capping is the renderer's responsibility
 *
 * Pure: same input refs ⇒ same output.
 */
export declare function referencesFromCluster(refs: readonly SourceRef[]): SourceRef[];
/**
 * Build the copyright-safe reference list for one ranked cluster.
 *
 * - resolves `cluster.memberIds` against `itemsById`
 * - keeps only items with a safe public canonical URL (others are dropped)
 * - dedups by `(source, title)`
 * - caps at `maxReferences` (default 5)
 * - never reads or emits body/summary text
 *
 * Pure: same cluster + same map ⇒ same references.
 */
export declare function referencesFor(cluster: RankedCluster, maxReferences?: number, itemsById?: ItemsById): SourceRef[];
