import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatSI, parseSI } from '../assets/units.js';

test('parseSI reads plain numbers, prefixes and RKM codes', () => {
  const cases = {
    '4.7k': 4700, '4k7': 4700, '470R': 470, '4R7': 4.7, R47: 0.47, '2.2µF': 2.2e-6, '2u2': 2.2e-6,
    '100n': 1e-7, '10p': 1e-11, '20mA': 0.02, '1M': 1e6, '1m': 0.001, '1meg': 1e6, '1MEG': 1e6, '1M5': 1.5e6,
    '3.3V': 3.3, '1e-3': 0.001, '  12 ': 12, '-5': -5, '+3.3': 3.3, '.5': 0.5, '4.7 kΩ': 4700, '10kohm': 10000,
    '10 ohms': 10, '1,000': 1000, '1,000.5k': 1000500, '1.5MHz': 1.5e6, '2200mAh': 2.2, '1.5mH': 0.0015, '5W': 5,
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(parseSI(input), expected, input);
  }
});

test('parseSI rejects things that are not values', () => {
  for (const input of ['', 'abc', 'A', 'mA', 'k', '4,7k', '1.2.3', '12x', null, undefined]) {
    assert.ok(Number.isNaN(parseSI(input)), String(input));
  }
});

test('formatSI picks a prefix and trims zeros', () => {
  assert.equal(formatSI(4700, 'Ω'), '4.7 kΩ');
  assert.equal(formatSI(0.02, 'A'), '20 mA');
  assert.equal(formatSI(3.3, 'V'), '3.3 V');
  assert.equal(formatSI(0, 'V'), '0 V');
  assert.equal(formatSI(1e6, 'Ω'), '1 MΩ');
  assert.equal(formatSI(0.00047, 'F'), '470 µF');
  assert.equal(formatSI(-3.3, 'V'), '-3.3 V');
  assert.equal(formatSI(1234.5678, 'W'), '1.235 kW');
  assert.equal(formatSI(999999, 'Ω', { digits: 3 }), '1 MΩ');
  assert.equal(formatSI(Infinity, 'Ω'), '∞ Ω');
  assert.equal(formatSI(NaN, 'Ω'), '—');
  assert.equal(formatSI(12), '12');
});

test('formatBytes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(980), '980 B');
  assert.equal(formatBytes(1536), '1.50 KB');
  assert.equal(formatBytes(34.5 * 1024 * 1024), '34.5 MB');
  assert.equal(formatBytes(NaN), '—');
});
