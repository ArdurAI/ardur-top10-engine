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
  assert.equal(
    safePublicUrl('https://reuters.com/article#section'),
    'https://reuters.com/article',
  );
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
