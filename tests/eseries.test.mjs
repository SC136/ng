import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERIES, nearestPreferred, seriesContaining } from '../assets/eseries.js';

// IEC 60063 E96, written out from the standard table.
const E96 = [
  100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143, 147, 150, 154, 158, 162, 165, 169, 174,
  178, 182, 187, 191, 196, 200, 205, 210, 215, 221, 226, 232, 237, 243, 249, 255, 261, 267, 274, 280, 287, 294, 301, 309,
  316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412, 422, 432, 442, 453, 464, 475, 487, 499, 511, 523, 536, 549,
  562, 576, 590, 604, 619, 634, 649, 665, 681, 698, 715, 732, 750, 768, 787, 806, 825, 845, 866, 887, 909, 931, 953, 976,
].map((n) => n / 100);

test('series have the right sizes', () => {
  for (const [name, list] of Object.entries(SERIES)) assert.equal(list.length, Number(name.slice(1)), name);
});

test('E96 matches the standard table, and E48 is every other value', () => {
  assert.deepEqual(SERIES.E96, E96);
  assert.deepEqual(SERIES.E48, E96.filter((_, i) => i % 2 === 0));
});

test('E192 contains E96 and has the 9.20 exception', () => {
  for (const value of E96) assert.ok(SERIES.E192.includes(value), String(value));
  assert.ok(SERIES.E192.includes(9.2));
  assert.ok(!SERIES.E192.includes(9.19));
});

test('nearestPreferred finds the closest value in each direction', () => {
  assert.equal(nearestPreferred(4800, 'E24'), 4700);
  assert.equal(nearestPreferred(4800, 'E24', 'up'), 5100);
  assert.equal(nearestPreferred(4800, 'E24', 'down'), 4700);
  assert.equal(nearestPreferred(4700, 'E24', 'up'), 4700);
  assert.equal(nearestPreferred(9.6, 'E12'), 10);
  assert.equal(nearestPreferred(0.47, 'E12'), 0.47);
  assert.equal(nearestPreferred(1e6, 'E96'), 1e6);
  assert.equal(nearestPreferred(5000, 'E96'), 4990);
  assert.ok(Number.isNaN(nearestPreferred(0)));
  assert.ok(Number.isNaN(nearestPreferred(-5)));
});

test('seriesContaining', () => {
  assert.deepEqual(seriesContaining(4700), ['E6', 'E12', 'E24', 'E192']);
  assert.deepEqual(seriesContaining(4990), ['E96', 'E192']);
  assert.deepEqual(seriesContaining(4870), ['E48', 'E96', 'E192']);
  assert.deepEqual(seriesContaining(0.47), ['E6', 'E12', 'E24', 'E192']);
  assert.deepEqual(seriesContaining(1234), []);
});
