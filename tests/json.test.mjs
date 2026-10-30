import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JsonError, MAX_DEPTH, codeFrame, describeJson, escapeJsonString, formatJson, jsonStats, lineCol, parseJson, printJson,
  sortKeys, unescapeJsonString,
} from '../tools/json/json.js';

const fmt = (text, options) => formatJson(text, options).output;
const errorOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('expected an error');
};

test('formats with 2 spaces, 4 spaces, tabs, and minifies', () => {
  const text = '{"a":1,"b":[true,false,null],"c":{}}';
  assert.equal(fmt(text), '{\n  "a": 1,\n  "b": [\n    true,\n    false,\n    null\n  ],\n  "c": {}\n}');
  assert.equal(fmt(text, { indent: 4 }), '{\n    "a": 1,\n    "b": [\n        true,\n        false,\n        null\n    ],\n    "c": {}\n}');
  assert.equal(fmt(text, { indent: '\t' }), '{\n\t"a": 1,\n\t"b": [\n\t\ttrue,\n\t\tfalse,\n\t\tnull\n\t],\n\t"c": {}\n}');
  assert.equal(fmt(' {\n "a" : 1 , "b":[ true , false , null ] , "c" : { } } ', { indent: 0 }), text);
  assert.equal(fmt('[]', { indent: 0 }), '[]');
});

test('output agrees with JSON.parse on ordinary documents', () => {
  const docs = ['{"x":[1,2.5,-3e10,{"y":"z"}],"u":"\\u00e9\\n"}', '"just a string"', '0', '[[[]]]', '{"":""}'];
  for (const doc of docs) {
    assert.deepEqual(JSON.parse(fmt(doc)), JSON.parse(doc));
    assert.deepEqual(JSON.parse(fmt(doc, { indent: 0 })), JSON.parse(doc));
  }
});

test('formatting is lossless: big numbers, number spelling, escapes and key order', () => {
  const text = '{"z":12345678901234567890,"a":1.50,"m":1E+2,"s":"\\u00e9\\/"}';
  assert.equal(fmt(text, { indent: 0 }), text);
  assert.match(fmt(text), /"z": 12345678901234567890/);
  assert.deepEqual(parseJson(text).tree.entries.map((e) => e.key), ['z', 'a', 'm', 's']);
  assert.equal(parseJson('-0.000000000000000000000001').tree.raw, '-0.000000000000000000000001');
});

test('sorts keys deeply while arrays keep their order', () => {
  const text = '{"b":{"y":1,"x":2},"a":[{"d":1,"c":2},3,1]}';
  assert.equal(fmt(text, { indent: 0, sort: true }), '{"a":[{"c":2,"d":1},3,1],"b":{"x":2,"y":1}}');
  // The original tree is untouched.
  const { tree } = parseJson(text);
  sortKeys(tree);
  assert.equal(printJson(tree, 0), text);
  // Keys are compared after unescaping.
  assert.equal(fmt('{"b":1,"\\u0061":2}', { indent: 0, sort: true }), '{"\\u0061":2,"b":1}');
});

test('counts duplicate keys', () => {
  assert.equal(parseJson('{"a":1,"a":2,"b":{"a":3}}').duplicates, 1);
  assert.equal(fmt('{"a":1,"a":2}', { indent: 0 }), '{"a":1,"a":2}');
});

test('stats and the status line', () => {
  const { tree } = parseJson('{"a":{"b":{"c":1}},"d":[1,2,{"e":null}]}');
  assert.deepEqual(jsonStats(tree), { keys: 5, items: 3, depth: 3, root: 'object' });
  assert.equal(describeJson(tree, 1234, () => '1.2 KB'), 'Valid JSON · 5 keys · depth 3 · 1.2 KB');
  assert.equal(describeJson(parseJson('[1,2]').tree, 5), 'Valid JSON · array of 2 items · depth 1 · 5 B');
  assert.equal(describeJson(parseJson('true').tree, 4), 'Valid JSON · a single boolean · depth 0 · 4 B');
  assert.equal(describeJson(parseJson('{"a":1}').tree, 7), 'Valid JSON · 1 key · depth 1 · 7 B');
});

test('errors carry line and column', () => {
  const error = errorOf(() => parseJson('{\n  "a": 1,\n  "b" 2\n}'));
  assert.ok(error instanceof JsonError);
  assert.match(error.message, /Expected ":"/);
  assert.equal(error.line, 3);
  assert.equal(error.column, 7);
  assert.deepEqual(lineCol('ab\ncd', 4), { line: 2, column: 2 });
});

test('error messages for common mistakes', () => {
  const cases = [
    ['{"a":1,}', /Trailing commas/, 7],
    ['[1,2,]', /Trailing commas/, 5],
    ["{'a':1}", /single quote/, 2],
    ['{a:1}', /property name in double quotes/, 2],
    ['{"a":01}', /leading zeros/, 6],
    ['[1.]', /decimal point/, 4],
    ['-', /minus sign/, 2],
    ['"abc', /never closed/, 1],
    ['"a\\x"', /isn't a valid escape/, 3],
    ['"\\u12G4"', /four hex digits/, 2],
    ['"a\nb"', /line break/, 3],
    ['[1 2]', /Expected "," or "]"/, 4],
    ['{"a":1 "b":2}', /Expected "," or "}"/, 8],
    ['[1,,2]', /value before this comma/, 4],
    ['{"a":[1,2}', /Expected "," or "]"/, 10],
    ['[1,2', /ended inside an array/, 1],
    ['{"a":1', /ended inside an object/, 1],
    ['{"a":True}', /Use true/, 6],
    ['{"a":undefined}', /Use null/, 6],
    ['[NaN]', /no NaN/, 2],
    ['{} {}', /after the end/, 4],
    ['   ', /no JSON here/, 4],
    ['{"a":}', /where a value was expected/, 6],
    ['// hi\n{}', /Comments aren't allowed/, 1],
  ];
  for (const [text, pattern, column] of cases) {
    const error = errorOf(() => parseJson(text));
    assert.match(error.message, pattern, text);
    assert.equal(error.column, column, `column for ${JSON.stringify(text)}`);
  }
});

test('JSONC: comments and trailing commas', () => {
  const text = '// config\n{\n  /* block */ "a": 1, // one\n  "b": [1, 2,],\n}\n';
  assert.equal(fmt(text, { jsonc: true, indent: 0 }), '{"a":1,"b":[1,2]}');
  assert.throws(() => parseJson(text), /Comments aren't allowed/);
  assert.equal(fmt('{"a":1,}', { jsonc: true, indent: 0 }), '{"a":1}');
  assert.throws(() => parseJson('[,]', { jsonc: true }), /value before this comma/);
  assert.throws(() => parseJson('{,}', { jsonc: true }), /property name/);
  assert.throws(() => parseJson('{} /* open', { jsonc: true }), /never closed with \*\//);
  assert.equal(fmt('{"url":"http://x//y"}', { jsonc: true, indent: 0 }), '{"url":"http://x//y"}');
});

test('a byte order mark at the start is ignored', () => {
  assert.equal(fmt('﻿{"a":1}', { indent: 0 }), '{"a":1}');
});

test('nesting is capped instead of overflowing the stack', () => {
  assert.equal(fmt('['.repeat(MAX_DEPTH) + ']'.repeat(MAX_DEPTH), { indent: 0 }).length, MAX_DEPTH * 2);
  assert.throws(() => parseJson('['.repeat(MAX_DEPTH + 1) + ']'.repeat(MAX_DEPTH + 1)), /nested more than/);
});

test('code frame shows the line before and a caret', () => {
  assert.equal(codeFrame('{\n  "b" 2\n}', 2, 7), '1 | {\n2 |   "b" 2\n  |       ^');
  assert.equal(codeFrame('[1 2]', 1, 4), '1 | [1 2]\n  |    ^');
  const long = 'x'.repeat(200) + 'Y' + 'x'.repeat(200);
  const frame = codeFrame(long, 1, 201, { width: 20 }).split('\n');
  assert.equal(frame[0].indexOf('Y'), frame[1].indexOf('^'));
  assert.match(frame[0], /^1 \| …x+Yx+…$/);
});

test('escape and unescape JSON strings', () => {
  assert.equal(escapeJsonString('He said "hi"\n\tC:\\path'), '"He said \\"hi\\"\\n\\tC:\\\\path"');
  assert.equal(unescapeJsonString('"He said \\"hi\\"\\n"'), 'He said "hi"\n');
  assert.equal(unescapeJsonString('caf\\u00e9 \\ud83d\\ude80'), 'café 🚀');
  const text = 'line 1\nline "2"\t\u0001 ✓';
  assert.equal(unescapeJsonString(escapeJsonString(text)), text);
  const bad = errorOf(() => unescapeJsonString('ab\\qc'));
  assert.match(bad.message, /isn't a valid escape/);
  assert.equal(bad.column, 3);
  const quote = errorOf(() => unescapeJsonString('say "hi'));
  assert.match(quote.message, /needs a backslash/);
  assert.equal(quote.column, 5);
});
