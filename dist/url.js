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
 * Query parameters that carry tracking / PII and must never appear in a public
 * reference URL. Mirrors the privacy posture of `FORBIDDEN_METRIC_KEY_FRAGMENTS`
 * in contracts.ts (utm_*, click ids, session/referrer markers).
 */
const TRACKING_PARAM_FRAGMENTS = [
    'utm_',
    'gclid',
    'fbclid',
    'mc_eid',
    'mc_cid',
    'igshid',
    'ref_',
    'ref=',
    'cmpid',
    'campaign',
    'session',
    'sessionid',
    'sid',
    'token',
    'email',
    'user',
];
function isTrackingParam(key) {
    const k = key.toLowerCase();
    return TRACKING_PARAM_FRAGMENTS.some((frag) => frag.endsWith('=') ? k === frag.slice(0, -1) : k.includes(frag));
}
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
export function safePublicUrl(raw) {
    if (!raw || typeof raw !== 'string')
        return null;
    const trimmed = raw.trim();
    if (trimmed === '')
        return null;
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        return null;
    }
    // HTTPS only — copyright-safe references link to public publisher pages.
    if (url.protocol !== 'https:')
        return null;
    const host = url.hostname.toLowerCase();
    if (!isPublicHost(host))
        return null;
    // Reject any URL carrying userinfo. Legitimate publisher pages never have
    // user:password@ credentials. Stripping silently changes the effective host
    // for userinfo-spoof patterns (https://trusted.com@evil.com resolves to
    // evil.com, not trusted.com), so rejection is safer than stripping.
    if (url.username !== '' || url.password !== '')
        return null;
    // Drop fragment and tracking params.
    url.hash = '';
    const kept = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
        if (!isTrackingParam(key))
            kept.append(key, value);
    }
    url.search = kept.toString();
    // Canonical-ish tidy-up: collapse a bare root path's trailing slash so
    // "https://a.com/" and "https://a.com" dedup to the same reference.
    let out = url.toString();
    if (url.pathname === '/' && url.search === '' && out.endsWith('/')) {
        out = out.slice(0, -1);
    }
    return out;
}
/** Reject loopback, private, link-local, and non-routable hosts. */
function isPublicHost(host) {
    if (host === '')
        return false;
    if (host === 'localhost' || host.endsWith('.localhost'))
        return false;
    if (host.endsWith('.local') || host.endsWith('.internal'))
        return false;
    // Bare IPv6 / IPv4 literals: a public reference should be a hostname, not an
    // IP. Reject the obvious private/loopback ranges and any raw IP to be safe.
    if (host.includes(':'))
        return false; // IPv6 literal
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        const octets = host.split('.').map(Number);
        const [a, b] = octets;
        if (a === 10 || a === 127 || a === 0)
            return false;
        if (a === 192 && b === 168)
            return false;
        if (a === 169 && b === 254)
            return false;
        if (a === 172 && b >= 16 && b <= 31)
            return false;
        // Any other raw IPv4 is still suspicious for a "publisher page" link; drop.
        return false;
    }
    // Must have a dot (a TLD) to be a real public host.
    return host.includes('.');
}
