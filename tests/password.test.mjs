import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIGUOUS, DEFAULT_SYMBOLS, buildPools, countPossible, crackSeconds, entropyBits, formatDuration, generateMany,
  generatePassword, generatePin, log2BigInt, randomInt, shuffle, strengthLabel,
} from '../tools/password/password.js';

// Deterministic stand-in for crypto.getRandomValues (mulberry32).
function seeded(seed) {
  let a = seed >>> 0;
  return (array) => {
    for (let i = 0; i < array.length; i++) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      array[i] = (t ^ (t >>> 14)) >>> 0;
    }
    return array;
  };
}

// Feeds a fixed list of 32-bit values.
function scripted(values) {
  let i = 0;
  return (array) => {
    for (let k = 0; k < array.length; k++) array[k] = values[i++];
    return array;
  };
}

test('randomInt rejects values that would bias the result', () => {
  // For max 3 the limit is 2^32 - 1, so 0xffffffff must be thrown away.
  assert.equal(randomInt(3, scripted([0xffffffff, 5])), 2);
  // For max 10, 2^32 % 10 = 6, so the top 6 values are rejected.
  assert.equal(randomInt(10, scripted([0xffffffff - 5, 0xffffffff - 6])), (0xffffffff - 6) % 10);
  assert.equal(randomInt(1, scripted([])), 0);
  assert.throws(() => randomInt(0), /whole number/);
});

test('randomInt is roughly uniform', () => {
  const rng = seeded(1);
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 60000; i++) counts[randomInt(6, rng)]++;
  for (const count of counts) assert.ok(Math.abs(count - 10000) < 500, `count ${count}`);
});

test('shuffle is a permutation and deterministic for a seed', () => {
  const a = shuffle([...'abcdefgh'], seeded(7)).join('');
  const b = shuffle([...'abcdefgh'], seeded(7)).join('');
  assert.equal(a, b);
  assert.equal([...a].sort().join(''), 'abcdefgh');
});

test('pools respect sets, exclusions and never overlap', () => {
  const pools = buildPools({ symbolSet: 'a!!#' });
  assert.deepEqual(pools.map((p) => p.name), ['lowercase', 'uppercase', 'digits', 'symbols']);
  assert.deepEqual(pools[3].chars, ['!', '#']);
  const noAmb = buildPools({ excludeAmbiguous: true }).flatMap((p) => p.chars);
  for (const ch of AMBIGUOUS) assert.ok(!noAmb.includes(ch), ch);
  const custom = buildPools({ exclude: 'abc0', symbols: false }).flatMap((p) => p.chars);
  assert.ok(!custom.includes('a') && !custom.includes('0') && custom.includes('d'));
  assert.equal(buildPools({ lower: false, upper: false, digits: false, symbols: true, symbolSet: '  ' }).length, 0);
});

test('passwords have the right length, alphabet and one from each set', () => {
  const rng = seeded(42);
  for (let i = 0; i < 200; i++) {
    const pw = generatePassword({ length: 4, symbolSet: '!@' }, rng);
    assert.equal(pw.length, 4);
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[A-Z]/);
    assert.match(pw, /[0-9]/);
    assert.match(pw, /[!@]/);
  }
  const digitsOnly = generatePassword({ length: 30, lower: false, upper: false, symbols: false }, rng);
  assert.match(digitsOnly, /^[0-9]{30}$/);
  assert.equal(generatePassword({ length: 12 }, seeded(3)), generatePassword({ length: 12 }, seeded(3)));
  assert.equal(generatePassword({ length: 128 }, rng).length, 128);
});

test('generator errors are plain', () => {
  assert.throws(() => generatePassword({ length: 3 }), /from 4 to 128/);
  assert.throws(() => generatePassword({ length: 129 }), /from 4 to 128/);
  assert.throws(() => generatePassword({ lower: false, upper: false, digits: false, symbols: false }), /at least one/);
  // A set emptied by exclusions is dropped instead of making "one from each" impossible.
  const pw = generatePassword({ length: 4, symbolSet: DEFAULT_SYMBOLS, exclude: '0123456789' }, seeded(1));
  assert.match(pw, /^[^0-9]{4}$/);
  assert.throws(() => generateMany('password', {}, 51), /1 to 50/);
});

test('PINs are digits only', () => {
  assert.match(generatePin(6, seeded(9)), /^\d{6}$/);
  const many = generateMany('pin', { length: 4 }, 50, seeded(10));
  assert.equal(many.length, 50);
  for (const pin of many) assert.match(pin, /^\d{4}$/);
});

test('entropy counts the real search space', () => {
  assert.equal(log2BigInt(1n << 200n), 200);
  assert.ok(Math.abs(log2BigInt(10n ** 30n) - 30 * Math.log2(10)) < 1e-9);
  // Two pools of 1 char each, length 2: only "ab" and "ba" use both.
  assert.equal(countPossible([1, 1], 2, true), 2n);
  assert.equal(countPossible([1, 1], 2, false), 4n);
  assert.equal(entropyBits('pin', { length: 4 }), 4 * Math.log2(10));
  const free = entropyBits('password', { length: 20, requireEach: false, symbols: false });
  assert.ok(Math.abs(free - 20 * Math.log2(62)) < 1e-9);
  const required = entropyBits('password', { length: 20, requireEach: true, symbols: false });
  assert.ok(required < free && required > free - 1);
});

test('strength labels and crack time', () => {
  assert.equal(strengthLabel(13.3).label, 'Very weak');
  assert.equal(strengthLabel(50).label, 'Fair');
  assert.equal(strengthLabel(128).label, 'Very strong');
  assert.equal(crackSeconds(1, 1), 1);
  assert.equal(formatDuration(crackSeconds(13.29)), 'less than a second');
  assert.equal(formatDuration(90), '2 minutes');
  assert.equal(formatDuration(3 * 86400), '3 days');
  assert.equal(formatDuration(365.25 * 86400 * 5e6), '5 million years');
  assert.match(formatDuration(crackSeconds(128)), /^about 10\^\d+ years$/);
});
