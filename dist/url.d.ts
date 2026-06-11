/**
 * URL normalization + safety for copyright-safe references.
 *
 * References must carry a *canonical, public, PII-free* link or be dropped.
 * Aggregated items arrive already normalized (contracts.ts: "normalized public
 * article URL, no PII, no fragment"), but this engine re-validates defensively
 * so a malformed upstream URL can never leak into a published `SourceRef`.
 *
 * Pure and deterministic: no network, no DNS. We screen on structure only.
 */
/**
 * Normalize a URL to a safe public form, or return `null` if it cannot be made
 * safe. Rules:
 *  - must parse and be `https:` (no http, no data:, no javascript:, no file:)
 *  - host must be a real public hostname (not localhost / private / *.local)
 *  - strips the fragment and all tracking query params
 *  - drops a trailing `?` and a trailing slash on the path root
 *
 * Returns a stable string so the same input always yields the same output
 * (required for idempotent, deterministic references).
 */
export declare function safePublicUrl(raw: string | null | undefined): string | null;
