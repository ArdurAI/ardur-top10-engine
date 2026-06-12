import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safePublicUrl } from './url.ts';

// ── Issue #7: userinfo / credential handling ──────────────────────────────────

test('safePublicUrl: rejects URL with username and password (credential leak)', () => {
  assert.equal(safePublicUrl('https://user:pass@reuters.com/article'), null);
});

test('safePublicUrl: rejects URL with username only (bare credential)', () => {
  assert.equal(safePublicUrl('https://user@reuters.com/article'), null);
});

test('safePublicUrl: rejects userinfo-spoof host (https://reuters.com@evil.com)', () => {
  // The real host is evil.com; reuters.com is userinfo.  Must return null, not
  // "https://evil.com/article" — silent host mutation is as dangerous as leaking.
  assert.equal(safePublicUrl('https://reuters.com@evil.com/article'), null);
});

test('safePublicUrl: rejects spoof with path and query', () => {
  assert.equal(safePublicUrl('https://reuters.com@evil.com/path?q=1'), null);
});

test('safePublicUrl: rejects credentials even with tracking params present', () => {
  assert.equal(safePublicUrl('https://u:p@reuters.com/a?utm_source=x#frag'), null);
});

// ── Normal-path smoke tests (ensure fixes didn't break happy-path) ─────────────

test('safePublicUrl: passes clean https URL unchanged', () => {
  assert.equal(
    safePublicUrl('https://reuters.com/article/2026-some-news'),
    'https://reuters.com/article/2026-some-news',
  );
});

test('safePublicUrl: strips fragment only', () => {
  assert.equal(safePublicUrl('https://reuters.com/article#section'), 'https://reuters.com/article');
});

test('safePublicUrl: strips tracking params, keeps non-tracking', () => {
  assert.equal(
    safePublicUrl('https://reuters.com/a?utm_source=google&id=123'),
    'https://reuters.com/a?id=123',
  );
});

test('safePublicUrl: rejects http (not https)', () => {
  assert.equal(safePublicUrl('http://reuters.com/article'), null);
});

test('safePublicUrl: rejects javascript: protocol', () => {
  assert.equal(safePublicUrl('javascript:alert(1)'), null);
});

test('safePublicUrl: rejects localhost', () => {
  assert.equal(safePublicUrl('https://localhost/article'), null);
});

test('safePublicUrl: rejects private IPv4', () => {
  assert.equal(safePublicUrl('https://192.168.1.1/article'), null);
});

test('safePublicUrl: rejects null, undefined, empty string', () => {
  assert.equal(safePublicUrl(null), null);
  assert.equal(safePublicUrl(undefined), null);
  assert.equal(safePublicUrl(''), null);
});

// ── Issue #14: tracking-param completeness (previously missing params) ──────────

test('safePublicUrl: strips dclid (DoubleClick)', () => {
  assert.equal(
    safePublicUrl('https://reuters.com/a?id=1&dclid=abc123'),
    'https://reuters.com/a?id=1',
  );
});

test('safePublicUrl: strips msclkid (Microsoft/Bing Ads)', () => {
  assert.equal(
    safePublicUrl('https://reuters.com/a?msclkid=xyz&q=news'),
    'https://reuters.com/a?q=news',
  );
});

test('safePublicUrl: strips twclid (Twitter/X Ads)', () => {
  assert.equal(safePublicUrl('https://reuters.com/a?twclid=twt123'), 'https://reuters.com/a');
});

test('safePublicUrl: strips li_fat_id (LinkedIn)', () => {
  assert.equal(safePublicUrl('https://reuters.com/a?li_fat_id=li456'), 'https://reuters.com/a');
});

test('safePublicUrl: strips yclid (Yandex)', () => {
  assert.equal(safePublicUrl('https://reuters.com/a?yclid=yandex789'), 'https://reuters.com/a');
});

test('safePublicUrl: strips _ga and _ga_* (Google Analytics client + measurement IDs)', () => {
  assert.equal(
    safePublicUrl('https://reuters.com/a?_ga=2.12345&_ga_ABCDEF=session.1234'),
    'https://reuters.com/a',
  );
});

test('safePublicUrl: strips _gl (Google Analytics cross-domain linker)', () => {
  assert.equal(safePublicUrl('https://reuters.com/a?_gl=1*abc*gcl'), 'https://reuters.com/a');
});

test('safePublicUrl: strips gbraid and wbraid (Google Ads privacy-sandbox click IDs)', () => {
  assert.equal(
    safePublicUrl('https://reuters.com/a?gbraid=gb1&wbraid=wb2'),
    'https://reuters.com/a',
  );
});

test('safePublicUrl: strips srsltid (Google Shopping / Merchant Center)', () => {
  assert.equal(safePublicUrl('https://reuters.com/a?srsltid=shop123'), 'https://reuters.com/a');
});

test('safePublicUrl: strips epik (Pinterest)', () => {
  assert.equal(safePublicUrl('https://reuters.com/a?epik=pin456'), 'https://reuters.com/a');
});

test('safePublicUrl: strips irclickid (Impact / affiliate)', () => {
  assert.equal(
    safePublicUrl('https://reuters.com/a?irclickid=ir789&ref=partner'),
    'https://reuters.com/a',
  );
});

test('safePublicUrl: non-tracking params survive alongside new tracking params', () => {
  assert.equal(
    safePublicUrl('https://reuters.com/a?article=123&msclkid=xyz&page=2&dclid=d'),
    'https://reuters.com/a?article=123&page=2',
  );
});

// ── Issue #14 finish: PII params from FORBIDDEN_METRIC_KEY_FRAGMENTS ────────────

test('safePublicUrl: strips referrer and referer params', () => {
  assert.equal(
    safePublicUrl('https://reuters.com/a?referrer=google.com&id=42'),
    'https://reuters.com/a?id=42',
  );
  assert.equal(
    safePublicUrl('https://reuters.com/a?referer=google.com&id=42'),
    'https://reuters.com/a?id=42',
  );
});

test('safePublicUrl: strips ipaddress param', () => {
  assert.equal(
    safePublicUrl('https://reuters.com/a?ipaddress=1.2.3.4&id=1'),
    'https://reuters.com/a?id=1',
  );
});

test('safePublicUrl: strips cookie and secret params', () => {
  assert.equal(safePublicUrl('https://reuters.com/a?cookie=abc'), 'https://reuters.com/a');
  assert.equal(safePublicUrl('https://reuters.com/a?secret=xyz'), 'https://reuters.com/a');
});

test('safePublicUrl: strips phone, fingerprint, useragent params', () => {
  assert.equal(safePublicUrl('https://reuters.com/a?phone=555-1234'), 'https://reuters.com/a');
  assert.equal(safePublicUrl('https://reuters.com/a?fingerprint=fp123'), 'https://reuters.com/a');
  assert.equal(safePublicUrl('https://reuters.com/a?useragent=Mozilla'), 'https://reuters.com/a');
});

test('safePublicUrl: strips userid, visitorid, deviceid, accountid params', () => {
  assert.equal(safePublicUrl('https://reuters.com/a?userid=u1&q=x'), 'https://reuters.com/a?q=x');
  assert.equal(safePublicUrl('https://reuters.com/a?visitorid=v1'), 'https://reuters.com/a');
  assert.equal(safePublicUrl('https://reuters.com/a?deviceid=d1'), 'https://reuters.com/a');
  assert.equal(safePublicUrl('https://reuters.com/a?accountid=a1'), 'https://reuters.com/a');
});

// ── Issue #14 finish: hex/decimal host guard (belt-and-suspenders) ───────────────

test('safePublicUrl: rejects bare hex IP 0x7f000001', () => {
  // WHATWG URL normalises 0x7f000001 to 127.0.0.1 (already caught by IPv4 check).
  // The explicit hex guard covers non-normalising environments.
  assert.equal(safePublicUrl('https://0x7f000001/'), null);
});

test('safePublicUrl: rejects bare decimal IP 2130706433 (=127.0.0.1)', () => {
  assert.equal(safePublicUrl('https://2130706433/'), null);
});

test('safePublicUrl: rejects bare hex 0xc0a80101 (=192.168.1.1)', () => {
  assert.equal(safePublicUrl('https://0xc0a80101/page'), null);
});
