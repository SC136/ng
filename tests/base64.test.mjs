import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  base64ToBytes, bytesToBase64, bytesToText, decodeBase64Text, encodeText, guessMime, hexPreview, parseDataUrl, toDataUrl,
} from '../tools/base64/base64.js';

const bytes = (...list) => Uint8Array.from(list);

test('RFC 4648 test vectors encode and decode', () => {
  const vectors = [['', ''], ['f', 'Zg=='], ['fo', 'Zm8='], ['foo', 'Zm9v'], ['foob', 'Zm9vYg=='], ['fooba', 'Zm9vYmE='], ['foobar', 'Zm9vYmFy']];
  for (const [plain, encoded] of vectors) {
    assert.equal(encodeText(plain), encoded);
    assert.equal(decodeBase64Text(encoded).text, plain);
  }
});

test('UTF-8 text survives a round trip', () => {
  assert.equal(encodeText('héllo'), 'aMOpbGxv');
  const text = 'héllo wörld ✓ 🚀 日本語';
  assert.equal(decodeBase64Text(encodeText(text)).text, text);
});

test('URL-safe alphabet and unpadded output', () => {
  assert.equal(bytesToBase64(bytes(0xfb, 0xff)), '+/8=');
  assert.equal(bytesToBase64(bytes(0xfb, 0xff), { urlSafe: true }), '-_8=');
  assert.equal(bytesToBase64(bytes(0xfb, 0xff), { urlSafe: true, pad: false }), '-_8');
  assert.deepEqual(base64ToBytes('-_8'), bytes(0xfb, 0xff));
  assert.deepEqual(base64ToBytes('+/8='), bytes(0xfb, 0xff));
});

test('decoding tolerates whitespace, line breaks and missing padding', () => {
  assert.equal(decodeBase64Text('Zm9v\nYmFy').text, 'foobar');
  assert.equal(decodeBase64Text('  Zm9vYg  ').text, 'foob');
  assert.equal(decodeBase64Text('Zm9vYmE').text, 'fooba');
});

test('bad input throws a message that says what is wrong', () => {
  assert.throws(() => base64ToBytes('Zm9v!'), /"!" at position 5/);
  assert.throws(() => base64ToBytes('Zm9vY'), /can't be valid Base64/);
  assert.throws(() => base64ToBytes('Zm=9v'), /only appear at the end/);
  assert.throws(() => base64ToBytes('Zg='), /Wrong amount/);
  assert.throws(() => base64ToBytes('Zm9v='), /Wrong amount/);
});

test('binary data is not mistaken for text', () => {
  assert.equal(bytesToText(bytes(0xff, 0xfe, 0x00)), null);
  assert.equal(bytesToText(bytes(0x00, 0x01, 0x02)), null);
  assert.equal(bytesToText(bytes(0x68, 0x69, 0x0a, 0x09)), 'hi\n\t');
  assert.equal(decodeBase64Text(bytesToBase64(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).text, null);
});

test('a leading byte-order mark is kept', () => {
  assert.equal(bytesToText(bytes(0xef, 0xbb, 0xbf, 0x61)), '﻿a');
});

test('data URLs decode, base64 or percent-encoded', () => {
  assert.deepEqual(parseDataUrl('data:text/plain;charset=utf-8;base64,aGk='), { mime: 'text/plain', base64: true, payload: 'aGk=' });
  assert.equal(parseDataUrl('not a data url'), null);
  assert.equal(decodeBase64Text('data:text/plain;base64,aGk=').text, 'hi');
  assert.equal(decodeBase64Text('data:text/plain;base64,aGk=').mime, 'text/plain');
  assert.equal(decodeBase64Text('data:,hello%20world').text, 'hello world');
  assert.throws(() => decodeBase64Text('data:,%E0%A4%A'), /percent-encoding/);
  assert.equal(toDataUrl(bytes(0x68, 0x69), 'text/plain'), 'data:text/plain;base64,aGk=');
});

test('file types are recognised from their first bytes', () => {
  assert.equal(guessMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)).ext, 'png');
  assert.equal(guessMime(bytes(0xff, 0xd8, 0xff, 0xe0)).ext, 'jpg');
  assert.equal(guessMime(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)).ext, 'webp');
  assert.equal(guessMime(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20)).ext, 'bin');
  assert.equal(guessMime(bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70)).ext, 'mp4');
  assert.equal(guessMime(bytes()).ext, 'bin');
});

test('hex preview', () => {
  assert.equal(hexPreview(bytes(0x89, 0x50, 0x4e)), '89 50 4e');
  assert.equal(hexPreview(bytes(1, 2, 3), 2), '01 02 …');
});

test('large inputs round trip without hitting argument limits', () => {
  const big = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 7) & 255);
  assert.deepEqual(base64ToBytes(bytesToBase64(big)), big);
});
