import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  divider, dividerR2, ledResistor, parseList, readValue, recommendedRating, seriesParallel, solveOhm,
} from '../tools/ohm/ohm.js';

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * 1e-9, `${label}: ${actual} vs ${expected}`);

test("Ohm's law from every pair", () => {
  const truth = { V: 12, I: 0.5, R: 24, P: 6 };
  const keys = ['V', 'I', 'R', 'P'];
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) {
      const known = { [keys[a]]: truth[keys[a]], [keys[b]]: truth[keys[b]] };
      const result = solveOhm(known);
      for (const key of keys) close(result[key], truth[key], `${keys[a]},${keys[b]} → ${key}`);
      assert.deepEqual(result.given, [keys[a], keys[b]]);
      assert.equal(Object.keys(result.formulas).length, 2);
    }
  }
});

test("Ohm's law shows formulas and accepts SI input", () => {
  const result = solveOhm({ V: readValue('5', 'V').value, I: readValue('20m', 'I').value });
  assert.equal(result.R, 250);
  assert.equal(result.P, 0.1);
  assert.deepEqual(result.formulas, { R: 'R = V / I', P: 'P = V × I' });
  assert.equal(solveOhm({ R: readValue('4k7', 'R').value, P: 0.25 }).formulas.V, 'V = √(P × R)');
});

test("Ohm's law needs exactly two positive values", () => {
  assert.throws(() => solveOhm({ V: 5 }), /any two/);
  assert.throws(() => solveOhm({ V: 5, I: 1, R: 5 }), /only two/);
  assert.throws(() => solveOhm({ V: 5, I: 0 }), /Current must be more than 0/);
});

test('readValue', () => {
  assert.deepEqual(readValue('  ', 'V'), { empty: true });
  assert.deepEqual(readValue('4k7', 'R'), { value: 4700 });
  assert.match(readValue('abc', 'Voltage').error, /Voltage: "abc" isn't a number/);
  assert.match(readValue('-3', 'Voltage').error, /more than 0/);
});

test('voltage divider', () => {
  const result = divider(12, 10000, 10000);
  assert.equal(result.vout, 6);
  assert.equal(result.current, 0.0006);
  assert.equal(result.p1, 0.0036);
  assert.equal(result.p2, 0.0036);
  assert.equal(result.total, 0.0072);
  close(divider(5, 1000, 2000).vout, 10 / 3, 'vout');
  assert.throws(() => divider(5, 0, 1000), /R1 and R2/);
});

test('voltage divider: R2 for a target output', () => {
  const result = dividerR2(5, 3.3, 10000);
  close(result.r2, 19411.764705882, 'r2');
  assert.deepEqual(result.options.map((o) => [o.series, o.r2]), [['E12', 18000], ['E24', 20000], ['E96', 19600]]);
  const e96 = result.options[2];
  close(e96.vout, 5 * 19600 / 29600, 'e96 vout');
  close(e96.error, ((5 * 19600 / 29600) - 3.3) / 3.3 * 100, 'e96 error');
  assert.throws(() => dividerR2(5, 5, 1000), /less than the input/);
  assert.throws(() => dividerR2(5, 0, 1000), /more than 0/);
});

test('LED resistor', () => {
  const result = ledResistor({ supply: 5, vf: 2, current: 0.02, count: 1 });
  assert.equal(result.drop, 3);
  assert.equal(result.resistance, 150);
  assert.equal(result.power, 0.06);
  assert.equal(result.standard, 150);
  assert.equal(result.actualCurrent, 0.02);
  assert.equal(result.rating, 0.125);

  const two = ledResistor({ supply: 12, vf: 3.2, current: 0.02, count: 3 });
  assert.equal(two.drop, 2.4);
  assert.equal(two.resistance, 120);

  const higher = ledResistor({ supply: 9, vf: 2, current: 0.02 });
  assert.equal(higher.resistance, 350);
  assert.equal(higher.standard, 360);
  close(higher.actualCurrent, 7 / 360, 'actual current');
  assert.equal(higher.rating, 0.5);
});

test('LED resistor errors', () => {
  assert.throws(() => ledResistor({ supply: 5, vf: 2.5, count: 2 }), /2 LEDs at 2.5 V need 5 V, which is not less than the 5 V supply/);
  assert.throws(() => ledResistor({ supply: 3, vf: 3.2 }), /1 LED at/);
  assert.throws(() => ledResistor({ supply: 5, vf: 2, count: 1.5 }), /whole number/);
});

test('power rating recommendation has 2x headroom', () => {
  assert.equal(recommendedRating(0.06), 0.125);
  assert.equal(recommendedRating(0.1), 0.25);
  assert.equal(recommendedRating(0.2), 0.5);
  assert.equal(recommendedRating(6), null);
});

test('series and parallel', () => {
  assert.deepEqual(seriesParallel([1000, 1000]), { series: 2000, parallel: 500, count: 2 });
  const { values } = parseList('100, 4k7\n1M  220R');
  assert.deepEqual(values, [100, 4700, 1e6, 220]);
  const result = seriesParallel([10, 20, 30]);
  assert.equal(result.series, 60);
  close(result.parallel, 60 / 11, 'parallel');
  assert.equal(seriesParallel([100, 0]).parallel, 0);
  assert.throws(() => parseList('100 abc'), /"abc" isn't a value/);
  assert.throws(() => seriesParallel([]), /at least one/);
});
