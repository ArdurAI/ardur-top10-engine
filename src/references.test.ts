import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safePublicUrl } from './url.ts';
import { referencesFor, indexItems } from './references.ts';
import { makeCluster, makeItem } from './fixtures.ts';

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
