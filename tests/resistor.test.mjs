import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bandRoles, decodeBands, describeRange, describeValue, encodeValue, optionsFor, parseResistance, seriesFor, tolerancesFor,
} from '../tools/resistor/resistor.js';

test('yellow violet red gold is 4.7 kΩ ±5%', () => {
  const result = decodeBands(['yellow', 'violet', 'red', 'gold']);
  assert.equal(result.ohms, 4700);
  assert.equal(result.tolerance, 5);
  assert.equal(describeValue(result), '4.7 kΩ ±5%');
  assert.equal(describeRange(result), '4.465 kΩ – 4.935 kΩ');
  assert.deepEqual(seriesFor(result.ohms), ['E6', 'E12', 'E24', 'E192']);
});

test('brown black black red brown is 10 kΩ ±1%', () => {
  const result = decodeBands(['brown', 'black', 'black', 'red', 'brown']);
  assert.equal(result.ohms, 10000);
  assert.equal(describeValue(result), '10 kΩ ±1%');
  assert.equal(result.min, 9900);
  assert.equal(result.max, 10100);
});

test('gold and silver multipliers give fractional values', () => {
  assert.equal(decodeBands(['yellow', 'violet', 'gold', 'gold']).ohms, 4.7);
  assert.equal(decodeBands(['yellow', 'violet', 'silver', 'gold']).ohms, 0.47);
  assert.equal(describeValue(decodeBands(['yellow', 'violet', 'silver', 'gold'])), '470 mΩ ±5%');
  assert.equal(decodeBands(['black', 'yellow', 'violet', 'gold', 'brown']).ohms, 4.7);
  assert.equal(decodeBands(['yellow', 'violet', 'black', 'silver', 'brown']).ohms, 4.7);
});

test('6-band resistors read the tempco band', () => {
  const result = decodeBands(['brown', 'black', 'black', 'red', 'brown', 'orange']);
  assert.equal(result.tempco, 15);
  assert.equal(describeValue(result), '10 kΩ ±1% 15 ppm/K');
  assert.equal(decodeBands(['brown', 'black', 'black', 'red', 'brown', 'yellow']).tempco, 25);
  assert.equal(decodeBands(['brown', 'black', 'black', 'red', 'brown', 'black']).tempco, 250);
});

test('no tolerance band means ±20%, only on 4-band resistors', () => {
  const result = decodeBands(['brown', 'black', 'orange', 'none']);
  assert.equal(describeValue(result), '10 kΩ ±20%');
  assert.throws(() => decodeBands(['brown', 'black', 'black', 'red', 'none']), /can't be band 5: tolerance/);
  assert.deepEqual(tolerancesFor(4), [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20]);
  assert.deepEqual(tolerancesFor(5), [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]);
});

test('band options per position', () => {
  assert.deepEqual(bandRoles(5), ['digit', 'digit', 'digit', 'multiplier', 'tolerance']);
  assert.equal(optionsFor('digit').length, 10);
  assert.equal(optionsFor('multiplier').length, 12);
  assert.equal(optionsFor('tempco').length, 9);
  assert.ok(!optionsFor('digit').some((c) => c.name === 'gold'));
  assert.throws(() => decodeBands(['gold', 'violet', 'red', 'gold']), /can't be band 1/);
  assert.throws(() => decodeBands(['red', 'red', 'red']), /4, 5 or 6 bands/);
});

test('reverse: values to bands', () => {
  assert.deepEqual(encodeValue(4700, { count: 4, tolerance: 5 }).bands, ['yellow', 'violet', 'red', 'gold']);
  assert.deepEqual(encodeValue(10000, { count: 5, tolerance: 1 }).bands, ['brown', 'black', 'black', 'red', 'brown']);
  assert.deepEqual(encodeValue(0.47, { count: 4, tolerance: 5 }).bands, ['yellow', 'violet', 'silver', 'gold']);
  assert.deepEqual(encodeValue(0.47, { count: 5, tolerance: 1 }).bands, ['black', 'yellow', 'violet', 'silver', 'brown']);
  assert.deepEqual(encodeValue(1e6, { count: 4, tolerance: 20 }).bands, ['brown', 'black', 'green', 'none']);
  assert.deepEqual(encodeValue(470, { count: 6, tolerance: 0.1, tempco: 50 }).bands, ['yellow', 'violet', 'black', 'black', 'violet', 'red']);
});

test('reverse round trips', () => {
  const cases = [
    [4, ['4k7', '470R', '1M', '10', '1', '0.1', 'R22', '82k', '99G']],
    [5, ['4k7', '470R', '1M', '4k99', '1k02', '0.47', '100', '999G']],
    [6, ['4k99', '12k1', '22R']],
  ];
  for (const [count, values] of cases) {
    for (const text of values) {
      const { value } = parseResistance(text);
      const encoded = encodeValue(value, { count, tolerance: count === 4 ? 5 : 1, tempco: 100 });
      assert.equal(encoded.exact, true, `${text} on ${count} bands`);
      assert.equal(decodeBands(encoded.bands).ohms, value, `${text} on ${count} bands`);
    }
  }
});

test('reverse: too many significant digits snaps to the nearest standard value', () => {
  const four = encodeValue(4750, { count: 4, tolerance: 5 });
  assert.equal(four.exact, false);
  assert.equal(four.series, 'E24');
  assert.equal(four.ohms, 4700);
  assert.deepEqual(four.bands, ['yellow', 'violet', 'red', 'gold']);
  const five = encodeValue(4996, { count: 5, tolerance: 1 });
  assert.equal(five.series, 'E96');
  assert.equal(five.ohms, 4990);
  assert.equal(encodeValue(1234, { count: 5, tolerance: 0.1 }).series, 'E192');
  const tiny = encodeValue(0.047, { count: 4, tolerance: 5 });
  assert.equal(decodeBands(tiny.bands).ohms, tiny.ohms);
});

test('reverse: errors', () => {
  assert.throws(() => encodeValue(0.001), /below 0.01/);
  assert.throws(() => encodeValue(1e12, { count: 4 }), /at most 99 GΩ/);
  assert.throws(() => encodeValue(1000, { count: 5, tolerance: 20 }), /don't come in ±20%/);
  assert.throws(() => encodeValue(1000, { count: 6, tolerance: 1, tempco: 7 }), /no tempco band/);
});

test('parseResistance', () => {
  assert.deepEqual(parseResistance('4k7'), { ok: true, value: 4700 });
  assert.deepEqual(parseResistance('470R'), { ok: true, value: 470 });
  assert.deepEqual(parseResistance('1M'), { ok: true, value: 1e6 });
  assert.equal(parseResistance('4.7 kΩ').value, 4700);
  assert.match(parseResistance('').error, /Enter a resistance/);
  assert.match(parseResistance('abc').error, /isn't a resistance/);
  assert.match(parseResistance('0').error, /single black band/);
  assert.match(parseResistance('-5').error, /negative/);
});
