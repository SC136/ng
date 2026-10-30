import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { RESERVED, listLinks, normalizeSlug, resolveShortLink, validateSlug, validateTarget } from '../assets/links.js';

const LINKS = { gh: 'https://github.com/SC136', yt: 'https://www.youtube.com/@SCSmartTech', mail: 'mailto:hello@example.com', q: 'https://example.com/search?q=x' };
const resolve = (path, search = '', hash = '') => resolveShortLink(path, search, hash, LINKS);

test('resolves slugs regardless of case and trailing slash', () => {
  assert.equal(resolve('/gh'), 'https://github.com/SC136');
  assert.equal(resolve('/GH/'), 'https://github.com/SC136');
  assert.equal(resolve('/yt'), 'https://www.youtube.com/@SCSmartTech');
});

test('appends extra path segments to the target', () => {
  assert.equal(resolve('/gh/ng'), 'https://github.com/SC136/ng');
  assert.equal(resolve('/gh/ng/tree/main/'), 'https://github.com/SC136/ng/tree/main');
  assert.equal(resolve('/gh/a%20b'), 'https://github.com/SC136/a%20b');
});

test('merges the query and keeps the hash', () => {
  assert.equal(resolve('/gh', '?tab=repositories'), 'https://github.com/SC136?tab=repositories');
  assert.equal(resolve('/q', '?page=2'), 'https://example.com/search?q=x&page=2');
  assert.equal(resolve('/gh', '', '#readme'), 'https://github.com/SC136#readme');
  // Extra path on a target that has its own query is ignored rather than mangled.
  assert.equal(resolve('/q/extra'), 'https://example.com/search?q=x');
});

test('mailto targets are passed through untouched', () => {
  assert.equal(resolve('/mail/extra', '?a=1'), 'mailto:hello@example.com');
});

test('unknown and empty paths are not short links', () => {
  assert.equal(resolve('/'), null);
  assert.equal(resolve(''), null);
  assert.equal(resolve('/nope'), null);
  assert.equal(resolve('/%E0%A4%A'), null);
});

test('unsafe targets are never followed', () => {
  assert.equal(resolveShortLink('/x', '', '', { x: 'javascript:alert(1)' }), null);
  assert.equal(resolveShortLink('/x', '', '', { x: 'not a url' }), null);
});

test('slug validation', () => {
  assert.equal(normalizeSlug(' /Hello/ '), 'hello');
  assert.deepEqual(validateSlug('new-thing', LINKS), { ok: true });
  assert.equal(validateSlug('', LINKS).ok, false);
  assert.equal(validateSlug('-bad', LINKS).ok, false);
  assert.equal(validateSlug('bad-', LINKS).ok, false);
  assert.equal(validateSlug('has space', LINKS).ok, false);
  assert.match(validateSlug('tools', LINKS).error, /real path/);
  assert.match(validateSlug('GH', LINKS).error, /already taken/);
  assert.equal(validateSlug('a'.repeat(64), LINKS).ok, true);
  assert.equal(validateSlug('a'.repeat(65), LINKS).ok, false);
});

test('target validation', () => {
  assert.equal(validateTarget('https://example.com').ok, true);
  assert.equal(validateTarget('mailto:a@b.co').ok, true);
  assert.equal(validateTarget('ftp://example.com').ok, false);
  assert.equal(validateTarget('example.com').ok, false);
});

test('links.json is valid', () => {
  const file = new URL('../links.json', import.meta.url);
  const links = JSON.parse(readFileSync(file, 'utf8'));
  const seen = new Set();
  for (const row of listLinks(links)) {
    assert.equal(row.error, null, `${row.slug}: ${row.error}`);
    assert.ok(!seen.has(row.slug.toLowerCase()), `duplicate slug ${row.slug}`);
    seen.add(row.slug.toLowerCase());
  }
});

test('no slug collides with a real top-level path', () => {
  const links = JSON.parse(readFileSync(new URL('../links.json', import.meta.url), 'utf8'));
  for (const slug of Object.keys(links)) {
    assert.ok(!RESERVED.has(slug), `${slug} is reserved`);
    assert.ok(!existsSync(new URL(`../${slug}`, import.meta.url)), `${slug} exists as a file or folder`);
    assert.ok(!existsSync(new URL(`../${slug}.html`, import.meta.url)), `${slug}.html exists`);
  }
});
