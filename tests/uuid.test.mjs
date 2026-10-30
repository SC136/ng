import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALPHABETS, checkAlphabet, createUlid, createUuidV7, CROCKFORD, decodeUlid, encodeUlidTime, formatUuid, generate, inspect, nanoid, nanoidBits,
  parseUuid,
} from '../tools/uuid/uuid.js';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

// A deterministic stand-in for crypto.getRandomValues.
function fakeRandom(seed = 1) {
  let state = seed;
  return {
    getRandomValues(array) {
      for (let i = 0; i < array.length; i++) {
        state = (state * 1103515245 + 12345) >>> 0;
        array[i] = state >>> 24;
      }
      return array;
    },
  };
}

const isSorted = (list) => list.every((item, i) => i === 0 || list[i - 1] < item);

test('v4 format, version and variant bits', () => {
  const ids = generate({ type: 'v4', count: 200 });
  for (const id of ids) assert.match(id, V4);
  assert.equal(new Set(ids).size, 200);
  assert.match(generate({ type: 'v4', uppercase: true })[0], /^[0-9A-F]{8}-[0-9A-F]{4}-4/);
  assert.match(generate({ type: 'v4', hyphens: false })[0], /^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/);
});

test('v7 format and timestamp round trip', () => {
  const time = Date.UTC(2024, 4, 17, 12, 30, 45, 678);
  const [id] = generate({ type: 'v7' }, { now: () => time });
  assert.match(id, V7);
  assert.equal(id.slice(0, 13).replace('-', ''), time.toString(16).padStart(12, '0'));
  const info = inspect(id);
  assert.equal(info.version, 7);
  assert.equal(info.variant, 'RFC 9562');
  assert.equal(info.time, time);
});

test('1000 v7 IDs sort in generation order, even within one millisecond', () => {
  const sameMs = generate({ type: 'v7', count: 1000 }, { now: () => 1_700_000_000_000 });
  assert.ok(isSorted(sameMs));
  assert.equal(new Set(sameMs).size, 1000);
  for (const id of sameMs) assert.match(id, V7);
  const real = generate({ type: 'v7', count: 1000 });
  assert.ok(isSorted(real));
  // A clock that jumps backwards must not break the order.
  const times = [5000, 5000, 4000, 6000];
  const next = createUuidV7({ now: () => times.shift() });
  const ids = Array.from({ length: 4 }, () => formatUuid(next()));
  assert.ok(isSorted(ids));
  assert.equal(inspect(ids[2]).time, 5000);
});

test('v7 counter overflow moves to the next millisecond', () => {
  const allOnes = { getRandomValues: (array) => array.fill(0xff) };
  const next = createUuidV7({ now: () => 1000, random: allOnes });
  const first = formatUuid(next());
  const second = formatUuid(next());
  assert.ok(first < second);
  assert.equal(inspect(second).time, 1001);
});

test('ULID reference values decode to their timestamps', () => {
  // 1469918176385 is the time in the ulid reference library's tests: its ULID starts 01ARYZ6S41.
  assert.equal(decodeUlid('01ARYZ6S41TSV4RRFFQ69G5FAV').time, 1469918176385);
  assert.equal(encodeUlidTime(1469918176385), '01ARYZ6S41');
  // The spec README's example ULID: 1·32^8 + 10·32^7 + 24·32^6 + … = 1469922850259.
  assert.equal(decodeUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV').time, 1469922850259);
  assert.equal(encodeUlidTime(1469922850259), '01ARZ3NDEK');
  assert.equal(decodeUlid('01arz3ndektsv4rrffq69g5fav').time, 1469922850259);
  assert.equal(decodeUlid('O1ARZ3NDEKTSV4RRFFQ69G5FAV').canonical, '01ARZ3NDEKTSV4RRFFQ69G5FAV');
  assert.throws(() => decodeUlid('01ARZ3NDEK'), /26 characters/);
  assert.throws(() => decodeUlid('01ARZ3NDEKTSV4RRFFQ69G5FAU'), /"U" isn't a ULID character/);
  assert.throws(() => decodeUlid('81ARZ3NDEKTSV4RRFFQ69G5FAV'), /too large/);
  assert.throws(() => encodeUlidTime(-1), /whole number/);
  const info = inspect('01ARYZ6S41TSV4RRFFQ69G5FAV');
  assert.equal(info.kind, 'ulid');
  assert.equal(info.time, 1469918176385);
});

test('1000 ULIDs sort in generation order, even within one millisecond', () => {
  const sameMs = generate({ type: 'ulid', count: 1000 }, { now: () => 1469918176385, random: fakeRandom(3) });
  for (const id of sameMs) assert.match(id, ULID);
  assert.ok(isSorted(sameMs));
  assert.equal(new Set(sameMs).size, 1000);
  assert.ok(sameMs.every((id) => id.startsWith('01ARYZ6S41')));
  assert.ok(isSorted(generate({ type: 'ulid', count: 1000 })));
  // The random part counts up by exactly one within a millisecond.
  const next = createUlid({ now: () => 0, random: { getRandomValues: (array) => array.fill(0) } });
  assert.equal(next(), '00000000000000000000000000');
  assert.equal(next(), '00000000000000000000000001');
});

test('nanoid size, alphabet and uniform choice', () => {
  const id = nanoid();
  assert.equal(id.length, 21);
  assert.match(id, /^[A-Za-z0-9_-]{21}$/);
  assert.equal(ALPHABETS.urlsafe.chars.length, 64);
  assert.match(nanoid(10, ALPHABETS.hex.chars), /^[0-9a-f]{10}$/);
  assert.match(nanoid(8, ALPHABETS.numbers.chars), /^\d{8}$/);
  assert.equal(nanoid(5, 'ab😀').length >= 5, true);
  // With 3 symbols the mask is 3, so byte value 3 must be rejected rather than wrapped.
  const bytes = [3, 3, 7, 0, 1, 2];
  const fake = { getRandomValues: (array) => { for (let i = 0; i < array.length; i++) array[i] = bytes.length ? bytes.shift() : 0; return array; } };
  assert.equal(nanoid(3, 'xyz', fake), 'xyz');
  // Rough uniformity over a 3-letter alphabet.
  const counts = { a: 0, b: 0, c: 0 };
  const long = Array.from({ length: 300 }, () => nanoid(100, 'abc')).join('');
  for (const ch of long) counts[ch]++;
  for (const value of Object.values(counts)) assert.ok(Math.abs(value - 10000) < 600, `count ${value}`);
});

test('nanoid alphabet and size errors', () => {
  assert.throws(() => checkAlphabet('a'), /at least 2/);
  assert.throws(() => checkAlphabet('abca'), /"a" appears more than once/);
  assert.throws(() => nanoid(0), /Size must be/);
  assert.equal(Math.round(nanoidBits(21, 64)), 126);
});

test('generate validates the count and type', () => {
  assert.equal(generate({ type: 'nanoid', count: 1000, size: 4 }).length, 1000);
  assert.throws(() => generate({ count: 0 }), /from 1 to 1000/);
  assert.throws(() => generate({ count: 1001 }), /from 1 to 1000/);
  assert.throws(() => generate({ type: 'v9' }), /Unknown ID type/);
});

test('inspector: RFC 9562 example UUIDs', () => {
  const v1 = inspect('C232AB00-9414-11EC-B3C8-9F6BDECED846');
  assert.equal(v1.version, 1);
  assert.equal(new Date(v1.time).toISOString(), '2022-02-22T19:22:22.000Z');
  assert.equal(v1.node, '9f:6b:de:ce:d8:46');
  const v6 = inspect('1EC9414C-232A-6B00-B3C8-9F6BDECED846');
  assert.equal(v6.version, 6);
  assert.equal(v6.time, v1.time);
  const v7 = inspect('017F22E2-79B0-7CC3-98C4-DC0C0C07398F');
  assert.equal(v7.version, 7);
  assert.equal(new Date(v7.time).toISOString(), '2022-02-22T19:22:22.000Z');
  const v4 = inspect('919108f7-52d1-4320-9bac-f847db4148a8');
  assert.equal(v4.version, 4);
  assert.equal(v4.time, null);
  assert.equal(v4.variant, 'RFC 9562');
});

test('inspector: nil, max, other forms and errors', () => {
  const nil = inspect('00000000-0000-0000-0000-000000000000');
  assert.equal(nil.nil, true);
  assert.equal(nil.valid, true);
  const max = inspect('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF');
  assert.equal(max.max, true);
  assert.equal(inspect('{919108F7-52D1-4320-9BAC-F847DB4148A8}').canonical, '919108f7-52d1-4320-9bac-f847db4148a8');
  assert.equal(inspect('urn:uuid:919108f7-52d1-4320-9bac-f847db4148a8').version, 4);
  assert.equal(inspect('919108f752d143209bacf847db4148a8').version, 4);
  assert.match(inspect('919108f7-52d1-4320-9bac-f847db4148').error, /32 hex digits; this has 30/);
  assert.match(inspect('V1StGXR8_Z5jdHi6B-myT').error, /isn't a UUID or a ULID/);
  assert.equal(inspect('').valid, false);
  assert.match(inspect('919108f7-52d1-4320-1bac-f847db4148a8').variant, /NCS/);
  assert.equal(inspect('919108f7-52d1-4320-1bac-f847db4148a8').version, null);
  assert.equal(parseUuid('nope'), null);
  assert.equal(CROCKFORD.length, 32);
});
