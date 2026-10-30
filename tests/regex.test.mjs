import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceIndex, cleanError, compile, groupCount, groupNames, matchAll, replacePreview, run, segments, supportedFlags, toLiteral,
} from '../tools/regex/regex.js';

const texts = (result) => result.matches.map((m) => m.text);

test('compile accepts good patterns and explains bad ones', () => {
  assert.equal(compile('a+b', 'gi').flags, 'gi');
  assert.throws(() => compile('(abc', ''), /^Error: Unterminated group$/);
  assert.throws(() => compile('a{2,1}', ''), /out of order/i);
  assert.throws(() => compile('a', 'gx'), /"x" isn't a regular expression flag/);
  assert.throws(() => compile('a', 'gg'), /"g" flag is repeated/);
  assert.throws(() => compile('a', 'uv'), /either the u or the v flag/);
  assert.equal(cleanError(new Error('Invalid regular expression: /(/: Unterminated group')), 'Unterminated group');
});

test('supported flags include the classic set', () => {
  const flags = supportedFlags();
  for (const flag of 'dgimsuy') assert.ok(flags.includes(flag), flag);
});

test('literal form escapes slashes and shows flags', () => {
  assert.equal(toLiteral('a/b', 'g'), '/a\\/b/g');
  assert.equal(toLiteral('', ''), '/(?:)/');
});

test('matchAll finds every match with g and only the first without', () => {
  assert.deepEqual(texts(matchAll(compile('\\d+', 'g'), 'a1 b22 c333')), ['1', '22', '333']);
  assert.deepEqual(texts(matchAll(compile('\\d+', ''), 'a1 b22 c333')), ['1']);
  const [first] = matchAll(compile('\\d+', 'g'), 'a1 b22').matches;
  assert.deepEqual([first.index, first.end], [1, 2]);
  assert.deepEqual(matchAll(compile('z', 'g'), 'abc'), { matches: [], truncated: false });
});

test('matchAll respects its limit', () => {
  const result = matchAll(compile('a', 'g'), 'a'.repeat(50), { limit: 10 });
  assert.equal(result.matches.length, 10);
  assert.equal(result.truncated, true);
  assert.equal(matchAll(compile('a', 'g'), 'a'.repeat(10), { limit: 10 }).truncated, false);
});

test('zero-length matches advance and stay visible', () => {
  const result = matchAll(compile('x*', 'g'), 'axb');
  assert.deepEqual(result.matches.map((m) => [m.index, m.text]), [[0, ''], [1, 'x'], [2, ''], [3, '']]);
  assert.equal(matchAll(compile('', 'g'), 'abc').matches.length, 4);
  assert.equal(matchAll(compile('\\b', 'g'), 'hi there').matches.length, 4);
  // In Unicode mode an empty match steps over a whole emoji, not half of one.
  assert.equal(matchAll(compile('', 'gu'), '😀').matches.length, 2);
  assert.equal(matchAll(compile('', 'g'), '😀').matches.length, 3);
  assert.equal(advanceIndex('😀', 0, true), 2);
  assert.equal(advanceIndex('😀', 0, false), 1);
});

test('sticky matching stops at the first gap', () => {
  assert.deepEqual(texts(matchAll(compile('a', 'gy'), 'aab a')), ['a', 'a']);
  assert.deepEqual(texts(matchAll(compile('b', 'y'), 'ab')), []);
});

test('numbered and named groups with positions', () => {
  const [m] = matchAll(compile('(?<year>\\d{4})-(\\d{2})(x)?', ''), 'on 2024-05!').matches;
  assert.deepEqual(m.groups, [
    { number: 1, name: 'year', value: '2024', start: 3, end: 7 },
    { number: 2, name: null, value: '05', start: 8, end: 10 },
    { number: 3, name: null, value: undefined, start: undefined, end: undefined },
  ]);
});

test('group names and counts skip lookarounds, classes and escapes', () => {
  assert.deepEqual(groupNames('(a)(?:b)(?<n>c)(?=d)(?<=e)(?<!f)\\(g\\)[(](h)'), [null, 'n', null]);
  assert.equal(groupCount(compile('(a)(?:b)(?<n>c)', 'g')), 2);
  assert.equal(groupCount(compile('x', 'y')), 0);
});

test('segments mark matches and empty matches', () => {
  const text = 'axb';
  const { matches } = matchAll(compile('x*', 'g'), text);
  assert.deepEqual(segments(text, matches), [
    { text: '', match: 0, empty: true },
    { text: 'a', match: null },
    { text: 'x', match: 1 },
    { text: '', match: 2, empty: true },
    { text: 'b', match: null },
    { text: '', match: 3, empty: true },
  ]);
  assert.deepEqual(segments('abc', []), [{ text: 'abc', match: null }]);
  assert.equal(segments('a1b2', matchAll(compile('\\d', 'g'), 'a1b2').matches).map((s) => s.text).join(''), 'a1b2');
});

test('replace preview supports $1, $<name>, $& and $$', () => {
  const regex = compile('(?<first>\\w+) (\\w+)', 'g');
  assert.equal(replacePreview(regex, 'ada lovelace', '$2, $<first>'), 'lovelace, ada');
  assert.equal(replacePreview(compile('\\d', 'g'), 'a1b2', '[$&]'), 'a[1]b[2]');
  assert.equal(replacePreview(compile('\\d', ''), 'a1b2', '#'), 'a#b2');
  assert.equal(replacePreview(compile('x', 'g'), 'x', '$$'), '$');
  // The original regex's lastIndex is not disturbed.
  regex.lastIndex = 3;
  replacePreview(regex, 'a b', '$2');
  assert.equal(regex.lastIndex, 3);
});

test('run bundles matches, preview and errors', () => {
  const result = run({ pattern: '(o)', flags: 'g', text: 'foo', replacement: '0' });
  assert.equal(result.matches.length, 2);
  assert.equal(result.preview, 'f00');
  assert.equal(result.groupCount, 1);
  assert.equal(run({ pattern: 'o', flags: '', text: 'foo', replacement: null }).preview, null);
  assert.throws(() => run({ pattern: '[', flags: '', text: '' }), /character class/i);
});
