import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import {
  Crc32, Md5, crc32, digestAll, findMatches, formatDigest, hexToBytes, hmacMd5, hmacSha, md5, toHex,
} from '../tools/hash/hash.js';

const text = (s) => new TextEncoder().encode(s);

test('MD5: RFC 1321 test suite', () => {
  const suite = [
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
    ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
  ];
  for (const [input, expected] of suite) assert.equal(toHex(md5(text(input))), expected, input);
});

test('MD5 across block boundaries and in pieces matches node:crypto', () => {
  for (const length of [55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + 7) & 255);
    const expected = createHash('md5').update(bytes).digest('hex');
    assert.equal(toHex(md5(bytes)), expected, `length ${length}`);
    const pieces = new Md5();
    for (let i = 0; i < length; i += 13) pieces.update(bytes.subarray(i, i + 13));
    assert.equal(toHex(pieces.digest()), expected, `pieces ${length}`);
  }
});

test('MD5 of UTF-8 text', () => {
  assert.equal(toHex(md5(text('héllo 🚀'))), createHash('md5').update('héllo 🚀').digest('hex'));
});

test('CRC32 check value and pieces', () => {
  assert.equal(crc32(text('123456789')).toString(16), 'cbf43926');
  assert.equal(crc32(text('')), 0);
  assert.equal(toHex(new Crc32().update(text('12345')).update(text('6789')).digest()), 'cbf43926');
  assert.equal(crc32(text('The quick brown fox jumps over the lazy dog')).toString(16), '414fa339');
});

test('SHA-256 of "abc" (FIPS 180-2)', async () => {
  const results = await digestAll(text('abc'));
  const sha256 = results.find((r) => r.name === 'SHA-256');
  assert.equal(toHex(sha256.bytes), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.deepEqual(results.map((r) => r.name), ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512', 'CRC32']);
  assert.equal(toHex(results[1].bytes), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(toHex(results[0].bytes), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(toHex(results[5].bytes), '352441c2');
});

test('HMAC-SHA256: RFC 4231 test case 2', async () => {
  const mac = await hmacSha('SHA-256', text('Jefe'), text('what do ya want for nothing?'));
  assert.equal(toHex(mac), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
});

test('HMAC-MD5: RFC 2104', () => {
  assert.equal(toHex(hmacMd5(text('Jefe'), text('what do ya want for nothing?'))), '750c783e6ab0b503eaa86e310a5db738');
  // RFC 2104 vector 1: key = 0x0b * 16, data = "Hi There".
  assert.equal(toHex(hmacMd5(new Uint8Array(16).fill(0x0b), text('Hi There'))), '9294727a3638bb1c13f48ef8158bfc9d');
  // Keys longer than the block size are hashed first (RFC 2202 test case 6).
  assert.equal(
    toHex(hmacMd5(new Uint8Array(80).fill(0xaa), text('Test Using Larger Than Block-Size Key - Hash Key First'))),
    '6b1ab7fe4bd7bf8f0b62e6ce61b9d0cd',
  );
});

test('digestAll with an HMAC key returns HMACs and no CRC32', async () => {
  const key = text('Jefe');
  const data = text('what do ya want for nothing?');
  const results = await digestAll(data, { hmacKey: key });
  assert.deepEqual(results.map((r) => r.name), ['HMAC-MD5', 'HMAC-SHA-1', 'HMAC-SHA-256', 'HMAC-SHA-384', 'HMAC-SHA-512']);
  assert.equal(toHex(results[0].bytes), '750c783e6ab0b503eaa86e310a5db738');
  assert.equal(toHex(results[2].bytes), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  assert.equal(toHex(results[4].bytes), createHmac('sha512', 'Jefe').update(data).digest('hex'));
  // An empty key means plain hashes.
  assert.equal((await digestAll(data, { hmacKey: new Uint8Array() }))[0].name, 'MD5');
});

test('digestAll reports progress and handles multi-chunk input', async () => {
  const bytes = Uint8Array.from({ length: 9 * 1024 * 1024 + 3 }, (_, i) => i & 255);
  const seen = [];
  const results = await digestAll(bytes, { onProgress: (f) => seen.push(f) });
  assert.equal(seen.length, 3);
  assert.equal(seen.at(-1), 1);
  assert.equal(toHex(results[0].bytes), createHash('md5').update(bytes).digest('hex'));
});

test('output formats', () => {
  const bytes = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0xfb]);
  assert.equal(formatDigest(bytes, 'hex'), 'deadbeeffb');
  assert.equal(formatDigest(bytes, 'HEX'), 'DEADBEEFFB');
  assert.equal(formatDigest(bytes, 'base64'), '3q2+7/s=');
});

test('compare finds the matching algorithm', async () => {
  const results = await digestAll(text('abc'));
  assert.deepEqual(findMatches('  BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD \n', results), ['SHA-256']);
  assert.deepEqual(findMatches('90:01:50:98:3c:d2:4f:b0:d6:96:3f:7d:28:e1:7f:72', results), ['MD5']);
  assert.deepEqual(findMatches(formatDigest(results[1].bytes, 'base64'), results), ['SHA-1']);
  assert.deepEqual(findMatches('352441C2', results), ['CRC32']);
  assert.deepEqual(findMatches('nope', results), []);
  assert.deepEqual(findMatches('   ', results), []);
});

test('hex keys', () => {
  assert.deepEqual(hexToBytes('0b0B 0b:0b'), Uint8Array.from([11, 11, 11, 11]));
  assert.deepEqual(hexToBytes('0xff'), Uint8Array.from([255]));
  assert.throws(() => hexToBytes('abc'), /even number/);
  assert.throws(() => hexToBytes('zz'), /aren't hex/);
});
