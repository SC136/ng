import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMATS, crc32, fitSize, formatById, hasTransparency, makeZip, outputName, parseLimit, savings, uniqueNames,
} from '../tools/image/image.js';

test('formats: WebP, JPEG, PNG, AVIF; only PNG is lossless', () => {
  assert.deepEqual(FORMATS.map((f) => f.id), ['webp', 'jpeg', 'png', 'avif']);
  assert.equal(formatById('jpeg').ext, 'jpg');
  assert.equal(formatById('png').lossy, false);
  assert.equal(formatById('gif'), null);
});

test('fitSize keeps aspect ratio inside the box', () => {
  assert.deepEqual(fitSize(4000, 3000, { maxWidth: 1600 }), { width: 1600, height: 1200, scaled: true });
  assert.deepEqual(fitSize(4000, 3000, { maxHeight: 600 }), { width: 800, height: 600, scaled: true });
  assert.deepEqual(fitSize(3000, 4000, { maxWidth: 1000, maxHeight: 1000 }), { width: 750, height: 1000, scaled: true });
  assert.deepEqual(fitSize(1001, 333, { maxWidth: 500 }), { width: 500, height: 166, scaled: true });
});

test('fitSize never upscales and never returns zero', () => {
  assert.deepEqual(fitSize(800, 600, { maxWidth: 1920, maxHeight: 1080 }), { width: 800, height: 600, scaled: false });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600, scaled: false });
  assert.deepEqual(fitSize(10000, 1, { maxWidth: 100 }), { width: 100, height: 1, scaled: true });
  assert.throws(() => fitSize(0, 10), /no size/);
});

test('limits parse as whole pixels, blank means none', () => {
  assert.equal(parseLimit('1920'), 1920);
  assert.equal(parseLimit(' 800.9 '), 800);
  assert.equal(parseLimit(''), null);
  assert.equal(parseLimit('0'), null);
  assert.equal(parseLimit('-5'), null);
  assert.equal(parseLimit('abc'), null);
});

test('output names swap the extension', () => {
  assert.equal(outputName('holiday.JPG', 'webp'), 'holiday.webp');
  assert.equal(outputName('archive.tar.png', 'jpg'), 'archive.tar.jpg');
  assert.equal(outputName('noext', 'png'), 'noext.png');
  assert.equal(outputName('.png', 'webp'), 'image.webp');
  assert.equal(outputName('', 'avif'), 'image.avif');
  assert.equal(outputName('C:\\photos\\a.png', 'webp'), 'a.webp');
  assert.equal(outputName('bad\u0000name.png', 'webp'), 'badname.webp');
});

test('unique names for the zip', () => {
  assert.deepEqual(uniqueNames(['a.webp', 'b.webp', 'a.webp', 'A.webp', 'a (2).webp']), ['a.webp', 'b.webp', 'a (2).webp', 'A (3).webp', 'a (2) (2).webp']);
  assert.deepEqual(uniqueNames(['x', 'x']), ['x', 'x (2)']);
});

test('savings: smaller, larger and equal are clear', () => {
  assert.deepEqual(savings(1000, 620), { percent: 38, smaller: true, text: '38% smaller', tone: 'ok' });
  const bigger = savings(1000, 1120);
  assert.equal(bigger.text, '12% larger');
  assert.equal(bigger.tone, 'warn');
  assert.equal(bigger.smaller, false);
  assert.ok(bigger.percent < 0);
  assert.equal(savings(1000, 1000).text, 'Same size');
  assert.equal(savings(1000, 999).text, 'Under 1% smaller');
  assert.equal(savings(1000, 1001).text, 'Under 1% larger');
  assert.equal(savings(0, 10).text, '');
});

test('transparency detection', () => {
  assert.equal(hasTransparency(Uint8ClampedArray.of(1, 2, 3, 255, 4, 5, 6, 255)), false);
  assert.equal(hasTransparency(Uint8ClampedArray.of(1, 2, 3, 255, 4, 5, 6, 254)), true);
  assert.equal(hasTransparency(new Uint8ClampedArray()), false);
});

test('CRC-32 check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test('ZIP archive structure', () => {
  const a = new TextEncoder().encode('hello');
  const b = Uint8Array.of(0, 1, 2, 255);
  const zip = makeZip([{ name: 'a.txt', bytes: a }, { name: 'ü.bin', bytes: b }], new Date(2024, 4, 17, 13, 45, 30));
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), crc32(a));
  assert.equal(new TextDecoder().decode(zip.subarray(30, 35)), 'a.txt');
  assert.equal(new TextDecoder().decode(zip.subarray(35, 40)), 'hello');
  // End of central directory record.
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  const cdOffset = view.getUint32(end + 16, true);
  const cdSize = view.getUint32(end + 12, true);
  assert.equal(cdOffset + cdSize, end);
  assert.equal(view.getUint32(cdOffset, true), 0x02014b50);
  // Second central entry points at the second local header.
  const second = cdOffset + 46 + 5;
  assert.equal(view.getUint32(second, true), 0x02014b50);
  const localOffset = view.getUint32(second + 42, true);
  assert.equal(localOffset, 30 + 5 + 5);
  assert.equal(view.getUint32(localOffset, true), 0x04034b50);
  assert.equal(new TextDecoder().decode(zip.subarray(second + 46, second + 46 + 6)), 'ü.bin');
  // DOS date: 2024-05-17, time 13:45:30.
  assert.equal(view.getUint16(12, true), ((2024 - 1980) << 9) | (5 << 5) | 17);
  assert.equal(view.getUint16(10, true), (13 << 11) | (45 << 5) | 15);
});

test('an empty ZIP is just the end record', () => {
  const zip = makeZip([]);
  assert.equal(zip.length, 22);
  assert.equal(new DataView(zip.buffer).getUint32(0, true), 0x06054b50);
});
