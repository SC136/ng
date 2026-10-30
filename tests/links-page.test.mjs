// Tests for the Short links page logic (tools/links/links.js).
// tests/links.test.mjs already covers the shared rules in assets/links.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EDIT_URL, LINKS_FILE, checkLinksData, checkNewLink, displayShort, filterLinks, jsonLine, listLinks, placementHint, qrHref,
} from '../tools/links/links.js';

const LINKS = { gh: 'https://github.com/SC136', yt: 'https://www.youtube.com/@SCSmartTech', me: 'https://swar.is-a.dev' };

test('re-exports the shared constants', () => {
  assert.equal(LINKS_FILE, '/links.json');
  assert.match(EDIT_URL, /^https:\/\/github\.com\/.+\/links\.json$/);
});

test('the real links.json loads and lists cleanly', () => {
  const data = checkLinksData(JSON.parse(readFileSync(new URL('../links.json', import.meta.url), 'utf8')));
  const rows = listLinks(data);
  assert.ok(rows.length > 0);
  for (const row of rows) assert.equal(row.error, null, row.slug);
});

test('checkLinksData rejects the wrong shape', () => {
  assert.throws(() => checkLinksData([]), /object/);
  assert.throws(() => checkLinksData(null), /object/);
  assert.throws(() => checkLinksData({ gh: 5 }), /"gh" should point to a URL string/);
  assert.deepEqual(checkLinksData(LINKS), LINKS);
});

test('filterLinks matches slug, short URL and target, all words', () => {
  const rows = listLinks(LINKS);
  assert.deepEqual(filterLinks(rows, '').map((r) => r.slug), ['gh', 'me', 'yt']);
  assert.deepEqual(filterLinks(rows, 'GH').map((r) => r.slug), ['gh']);
  assert.deepEqual(filterLinks(rows, 'youtube').map((r) => r.slug), ['yt']);
  assert.deepEqual(filterLinks(rows, 'ng.foo.ng/me').map((r) => r.slug), ['me']);
  assert.deepEqual(filterLinks(rows, 'https github').map((r) => r.slug), ['gh']);
  assert.deepEqual(filterLinks(rows, 'nothing-here'), []);
});

test('QR link and short display', () => {
  assert.equal(qrHref('https://ng.foo.ng/gh'), '/tools/qr/#text=https%3A%2F%2Fng.foo.ng%2Fgh');
  assert.equal(displayShort('https://ng.foo.ng/gh'), 'ng.foo.ng/gh');
});

test('jsonLine places the new link alphabetically', () => {
  assert.deepEqual(jsonLine('hi', 'https://example.com', LINKS), { line: '  "hi": "https://example.com",', after: 'gh', last: false });
  assert.deepEqual(jsonLine('zz', 'https://example.com', LINKS), { line: '  "zz": "https://example.com"', after: 'yt', last: true });
  assert.deepEqual(jsonLine('aa', 'https://example.com', LINKS), { line: '  "aa": "https://example.com",', after: null, last: false });
  assert.deepEqual(jsonLine('first', 'https://example.com', {}), { line: '  "first": "https://example.com"', after: null, last: true });
  // Quotes and backslashes are escaped so the line stays valid JSON.
  assert.equal(jsonLine('q', 'https://example.com/?a="b"', LINKS).line, '  "q": "https://example.com/?a=\\"b\\"",');
  assert.equal(jsonLine('  Blog ', ' https://example.com ', LINKS).line, '  "blog": "https://example.com",');
});

test('placementHint explains where the line goes', () => {
  assert.equal(placementHint({ after: 'gh', last: false }), 'Add it after the "gh" line.');
  assert.match(placementHint({ after: 'yt', last: true }), /comma after the "yt" line/);
  assert.match(placementHint({ after: null, last: false }), /first entry/);
});

test('checkNewLink validates slug and target against the loaded links', () => {
  const good = checkNewLink('blog', 'https://example.com/blog', LINKS);
  assert.equal(good.ok, true);
  assert.equal(good.short, 'https://ng.foo.ng/blog');
  assert.equal(good.snippet.line, '  "blog": "https://example.com/blog",');

  const taken = checkNewLink('GH', 'https://example.com', LINKS);
  assert.equal(taken.ok, false);
  assert.match(taken.slug.error, /already taken/);
  assert.equal(taken.snippet, null);

  assert.match(checkNewLink('tools', 'https://example.com', LINKS).slug.error, /real path/);
  assert.match(checkNewLink('-bad', 'https://example.com', LINKS).slug.error, /lowercase letters/);
  assert.match(checkNewLink('ok', 'example.com', LINKS).target.error, /full URL/);
  assert.match(checkNewLink('ok', 'ftp://example.com', LINKS).target.error, /Only https/);
  assert.equal(checkNewLink('', '', LINKS).short, '');
});
