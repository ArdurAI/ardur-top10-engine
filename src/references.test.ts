import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safePublicUrl } from './url.ts';
import { referencesFor, referencesFromCluster, indexItems } from './references.ts';
import { makeCluster, makeItem } from './fixtures.ts';
import type { SourceRef } from '@ardurai/contracts';

// --- url safety ---------------------------------------------------------------

test('safePublicUrl accepts https and strips fragment + tracking params', () => {
  assert.equal(
    safePublicUrl('https://reuters.com/a/b?utm_source=x&id=7#section'),
    'https://reuters.com/a/b?id=7',
  );
});

test('safePublicUrl collapses a bare-root trailing slash', () => {
  assert.equal(safePublicUrl('https://reuters.com/'), 'https://reuters.com');
});

test('safePublicUrl rejects non-https, localhost, private and raw IPs', () => {
  assert.equal(safePublicUrl('http://reuters.com/a'), null);
  assert.equal(safePublicUrl('javascript:alert(1)'), null);
  assert.equal(safePublicUrl('https://localhost/a'), null);
  assert.equal(safePublicUrl('https://127.0.0.1/a'), null);
  assert.equal(safePublicUrl('https://192.168.1.5/a'), null);
  assert.equal(safePublicUrl('https://10.0.0.1/a'), null);
  assert.equal(safePublicUrl('https://service.internal/a'), null);
  assert.equal(safePublicUrl(''), null);
  assert.equal(safePublicUrl(undefined), null);
});

// --- referencesFor ------------------------------------------------------------

test('referencesFor dedups by (source,title) and caps at maxReferences', () => {
  const items = [
    makeItem({ id: 'i1', source: 'Reuters', title: 'A', url: 'https://reuters.com/1' }),
    makeItem({ id: 'i2', source: 'Reuters', title: 'A', url: 'https://reuters.com/2' }), // dup (source,title)
    makeItem({ id: 'i3', source: 'Bloomberg', title: 'B', url: 'https://bloomberg.com/3' }),
    makeItem({ id: 'i4', source: 'InfoQ', title: 'C', url: 'https://infoq.com/4' }),
    makeItem({ id: 'i5', source: 'NIST', title: 'D', url: 'https://nist.gov/5' }),
    makeItem({ id: 'i6', source: 'Ars', title: 'E', url: 'https://arstechnica.com/6' }),
    makeItem({ id: 'i7', source: 'The Reg', title: 'F', url: 'https://theregister.com/7' }),
  ];
  const cluster = makeCluster({ clusterId: 'c1', memberIds: items.map((i) => i.id) });
  const refs = referencesFor(cluster, 5, indexItems(items));

  assert.equal(refs.length, 5); // capped
  const keys = refs.map((r) => `${r.source}|${r.title}`);
  assert.equal(new Set(keys).size, keys.length); // no dup (source,title)
  for (const r of refs) {
    assert.match(r.url, /^https:\/\//);
    assert.ok(r.publishedAt);
  }
});

test('referencesFor drops members without a safe public URL', () => {
  const items = [
    makeItem({ id: 'i1', url: 'http://insecure.com/x', sourceUrl: 'http://insecure.com' }),
    makeItem({ id: 'i2', source: 'OK', title: 'ok', url: 'https://ok.com/x' }),
  ];
  const cluster = makeCluster({ clusterId: 'c1', memberIds: ['i1', 'i2'] });
  const refs = referencesFor(cluster, 5, indexItems(items));
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.source, 'OK');
});

test('referencesFor never leaks body/summary text', () => {
  const items = [makeItem({ id: 'i1', summaryHint: 'LEAK-ME body text', url: 'https://x.com/1' })];
  const cluster = makeCluster({ clusterId: 'c1', memberIds: ['i1'] });
  const refs = referencesFor(cluster, 5, indexItems(items));
  assert.ok(!JSON.stringify(refs).includes('LEAK-ME'));
});

test('referencesFor orders by tier (authoritative first) then recency', () => {
  const items = [
    makeItem({
      id: 'i1',
      source: 'News',
      title: 'n',
      tier: 'news',
      url: 'https://n.com/1',
      publishedAt: '2026-06-11T06:00:00Z',
    }),
    makeItem({
      id: 'i2',
      source: 'Vendor',
      title: 'p',
      tier: 'primary',
      url: 'https://v.com/2',
      publishedAt: '2026-06-11T05:00:00Z',
    }),
    makeItem({
      id: 'i3',
      source: 'News2',
      title: 'n2',
      tier: 'news',
      url: 'https://n2.com/3',
      publishedAt: '2026-06-11T07:00:00Z',
    }),
  ];
  const cluster = makeCluster({ clusterId: 'c1', memberIds: ['i1', 'i2', 'i3'] });
  const refs = referencesFor(cluster, 5, indexItems(items));
  assert.equal(refs[0]?.tier, 'primary'); // most authoritative first
  // within 'news', the newer one (i3 @07:00) precedes i1 @06:00
  assert.equal(refs[1]?.source, 'News2');
  assert.equal(refs[2]?.source, 'News');
});

test('referencesFor returns [] when no items resolve (no aggregation)', () => {
  const cluster = makeCluster({ clusterId: 'c1', memberIds: ['x', 'y'] });
  assert.deepEqual(referencesFor(cluster, 5, {}), []);
});

test('referencesFor honors a cap of 0', () => {
  const items = [makeItem({ id: 'i1', url: 'https://x.com/1' })];
  const cluster = makeCluster({ clusterId: 'c1', memberIds: ['i1'] });
  assert.deepEqual(referencesFor(cluster, 0, indexItems(items)), []);
});

// --- referencesFromCluster (Rev 3 path) ----------------------------------------

function makeRef(over: Partial<SourceRef> & { url: string }): SourceRef {
  return {
    source: 'Reuters',
    sourceDomain: 'reuters.com',
    tier: 'news',
    title: 'Test article',
    publishedAt: '2026-06-11T06:00:00Z',
    ...over,
  };
}

test('referencesFromCluster passes through all refs with safe URLs (no cap)', () => {
  const refs = Array.from({ length: 12 }, (_, i) =>
    makeRef({ url: `https://reuters.com/article-${i}`, title: `Art ${i}` }),
  );
  const out = referencesFromCluster(refs);
  assert.equal(out.length, 12); // uncapped — all 12 pass through
});

test('referencesFromCluster drops refs with unsafe URLs', () => {
  const refs = [
    makeRef({ url: 'http://insecure.com/x' }), // non-https → dropped
    makeRef({ url: 'https://ok.com/y' }),
    makeRef({ url: 'https://127.0.0.1/z' }), // private IP → dropped
  ];
  const out = referencesFromCluster(refs);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.url, 'https://ok.com/y');
});

test('referencesFromCluster sanitizes URLs (strips tracking params)', () => {
  const refs = [makeRef({ url: 'https://reuters.com/a?utm_source=x&id=7' })];
  const out = referencesFromCluster(refs);
  assert.equal(out[0]?.url, 'https://reuters.com/a?id=7');
});

test('referencesFromCluster returns [] for empty input', () => {
  assert.deepEqual(referencesFromCluster([]), []);
});

// ── Issue #17: indexItems must use null-prototype map ──────────────────────────

test('indexItems returns a null-prototype map (no inherited Object.prototype props)', () => {
  const items = [makeItem({ id: 'i1', url: 'https://x.com/1' })];
  const map = indexItems(items);
  assert.equal(Object.getPrototypeOf(map), null);
});

test('indexItems: item with id="__proto__" is stored as own property, not prototype mutation', () => {
  const item = makeItem({ id: '__proto__', url: 'https://reuters.com/proto' });
  const map = indexItems([item]);
  // The map's prototype must still be null (not replaced by item)
  assert.equal(Object.getPrototypeOf(map), null);
  // The item must be retrievable via own property
  const desc = Object.getOwnPropertyDescriptor(map, '__proto__');
  assert.ok(desc !== undefined, 'own descriptor exists for __proto__ key');
  assert.equal(desc.value, item);
});

test('indexItems: item with id="constructor" is stored safely', () => {
  const item = makeItem({ id: 'constructor', url: 'https://reuters.com/ctor' });
  const map = indexItems([item]);
  assert.ok(Object.prototype.hasOwnProperty.call(map, 'constructor'));
});

test('referencesFor resolves a member with id="__proto__" from null-prototype map', () => {
  const item = makeItem({
    id: '__proto__',
    clusterId: 'c1',
    source: 'Reuters',
    title: 'Proto article',
    url: 'https://reuters.com/proto-article',
  });
  const cluster = makeCluster({ clusterId: 'c1', memberIds: ['__proto__'] });
  const refs = referencesFor(cluster, 5, indexItems([item]));
  assert.equal(refs.length, 1, 'reference resolved');
  assert.equal(refs[0]?.url, 'https://reuters.com/proto-article');
});
