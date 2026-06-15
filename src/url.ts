/**
 * URL normalization + safety for copyright-safe references.
 *
 * References must carry a *canonical, public, PII-free* link or be dropped.
 * Aggregated items arrive already normalized (@ardurai/contracts: "normalized public
 * article URL, no PII, no fragment"), but this engine re-validates defensively
 * so a malformed upstream URL can never leak into a published `SourceRef`.
 *
 * Pure and deterministic: no network, no DNS, no wall-clock reads.
 */

/**
 * Query parameters that carry tracking / PII and must never appear in a public
 * reference URL. Aligned with (and a superset of) `FORBIDDEN_METRIC_KEY_FRAGMENTS`
 * in @ardurai/contracts — the contracts list guards metric keys; this list guards
 * URL query params, which overlap but also include ad-network click IDs not found
 * in metric keys.
 *
 * Matching rule: a fragment ending in '=' requires exact key equality (after
 * removing the '='); all other fragments are substring-matched against the
 * lowercased key.
 */
const TRACKING_PARAM_FRAGMENTS: readonly string[] = [
  // UTM family (Google Analytics campaign params)
  'utm_',
  // Google: click IDs, Analytics, display/shopping
  'gclid',
  'dclid',
  '_ga',
  '_gl',
  'gbraid',
  'wbraid',
  'srsltid',
  // Meta / Facebook
  'fbclid',
  // Microsoft / Bing Ads
  'msclkid',
  // Twitter / X Ads
  'twclid',
  // LinkedIn First-Party Ad Tracking
  'li_fat_id',
  // Yandex
  'yclid',
  // Pinterest
  'epik',
  // Impact / affiliate networks
  'irclickid',
  // Mailchimp
  'mc_eid',
  'mc_cid',
  // Instagram
  'igshid',
  // Generic referral / campaign markers (from FORBIDDEN_METRIC_KEY_FRAGMENTS)
  'ref_',
  'ref=',
  'cmpid',
  'campaign',
  'referrer',
  'referer',
  // Session / auth / PII markers (from FORBIDDEN_METRIC_KEY_FRAGMENTS)
  'session',
  'sessionid',
  'sid=',
  'token',
  'secret',
  'cookie',
  'email',
  'phone=',
  'user=',
  'userid',
  'visitorid',
  'deviceid',
  'accountid',
  'ipaddress',
  'useragent',
  'fingerprint',
];

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return TRACKING_PARAM_FRAGMENTS.some((frag) =>
    frag.endsWith('=') ? k === frag.slice(0, -1) : k.includes(frag),
  );
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
export function safePublicUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  // HTTPS only — copyright-safe references link to public publisher pages.
  if (url.protocol !== 'https:') return null;

  // Strip trailing dot: FQDN notation (e.g. "localhost.") must not bypass host guards,
  // and must not appear in the normalized output URL (canonical form has no trailing dot).
  const rawHost = url.hostname.toLowerCase();
  const host = rawHost.endsWith('.') ? rawHost.slice(0, -1) : rawHost;
  if (host !== rawHost) url.hostname = host; // normalize URL object to strip the dot
  if (!isPublicHost(host)) return null;

  // Reject any URL carrying userinfo. Legitimate publisher pages never have
  // user:password@ credentials. Stripping silently changes the effective host
  // for userinfo-spoof patterns (https://trusted.com@evil.com resolves to
  // evil.com, not trusted.com), so rejection is safer than stripping.
  if (url.username !== '' || url.password !== '') return null;

  // Drop fragment and tracking params.
  url.hash = '';
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (!isTrackingParam(key)) kept.append(key, value);
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
function isPublicHost(host: string): boolean {
  if (host === '') return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.endsWith('.local') || host.endsWith('.internal')) return false;

  // Bare IPv6 / IPv4 literals: a public reference should be a hostname, not an
  // IP. Reject the obvious private/loopback ranges and any raw IP to be safe.
  if (host.includes(':')) return false; // IPv6 literal

  // Reject bare integer/hex representations of IP addresses (e.g. 0x7f000001,
  // 2130706433) that some resolvers treat as 127.0.0.1. The WHATWG URL parser
  // normalises most of these to dotted decimal before we see them; this guard
  // is belt-and-suspenders for environments that may not.
  if (/^(0x[\da-f]+|\d+)$/i.test(host)) return false;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const octets = host.split('.').map(Number);
    const [a, b] = octets as [number, number, number, number];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    // Any other raw IPv4 is still suspicious for a "publisher page" link; drop.
    return false;
  }

  // Must have a dot (a TLD) to be a real public host.
  return host.includes('.');
}
