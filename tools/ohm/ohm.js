// Ohm's law, voltage divider, LED resistor and series/parallel logic. No DOM access, so Node tests can import it.
import { formatSI, parseSI } from '../../assets/units.js';
import { nearestPreferred } from '../../assets/eseries.js';

export const UNITS = { V: 'V', I: 'A', R: 'Ω', P: 'W' };
export const NAMES = { V: 'Voltage', I: 'Current', R: 'Resistance', P: 'Power' };

/**
 * Parses an input field. Empty text is { empty: true }; otherwise { value } or { error }.
 * options.positive rejects zero and negatives (the default); options.min/max bound the value.
 */
export function readValue(text, label, { positive = true } = {}) {
  const s = String(text ?? '').trim();
  if (!s) return { empty: true };
  const value = parseSI(s);
  if (Number.isNaN(value)) return { error: `${label}: "${s}" isn't a number. Try 5, 3.3, 20m or 4k7.` };
  if (positive && !(value > 0)) return { error: `${label} must be more than 0.` };
  return { value };
}

const FORMULAS = {
  'V,I': { R: 'R = V / I', P: 'P = V × I', calc: ({ V, I }) => ({ R: V / I, P: V * I }) },
  'V,R': { I: 'I = V / R', P: 'P = V² / R', calc: ({ V, R }) => ({ I: V / R, P: (V * V) / R }) },
  'V,P': { I: 'I = P / V', R: 'R = V² / P', calc: ({ V, P }) => ({ I: P / V, R: (V * V) / P }) },
  'I,R': { V: 'V = I × R', P: 'P = I² × R', calc: ({ I, R }) => ({ V: I * R, P: I * I * R }) },
  'I,P': { V: 'V = P / I', R: 'R = P / I²', calc: ({ I, P }) => ({ V: P / I, R: P / (I * I) }) },
  'R,P': { V: 'V = √(P × R)', I: 'I = √(P / R)', calc: ({ R, P }) => ({ V: Math.sqrt(P * R), I: Math.sqrt(P / R) }) },
};

const tidy = (value) => Number(value.toPrecision(12));

/**
 * Solves Ohm's law from exactly two of { V, I, R, P } (all > 0).
 * Returns { V, I, R, P, given: ['V', 'I'], formulas: { R: 'R = V / I', … } }. Throws otherwise.
 */
export function solveOhm(known) {
  const given = ['V', 'I', 'R', 'P'].filter((key) => known[key] != null && !Number.isNaN(known[key]));
  if (given.length !== 2) {
    throw new Error(given.length < 2 ? 'Enter any two of voltage, current, resistance and power.' : 'Enter only two values. Clear the others to calculate them.');
  }
  for (const key of given) {
    if (!(known[key] > 0) || !Number.isFinite(known[key])) throw new Error(`${NAMES[key]} must be more than 0.`);
  }
  const entry = FORMULAS[given.join(',')];
  const values = { [given[0]]: known[given[0]], [given[1]]: known[given[1]] };
  const computed = entry.calc(values);
  const formulas = {};
  for (const key of Object.keys(computed)) {
    values[key] = tidy(computed[key]);
    formulas[key] = entry[key];
  }
  return { V: values.V, I: values.I, R: values.R, P: values.P, given, formulas };
}

/**
 * Unloaded voltage divider: Vin across R1 then R2, Vout across R2.
 * Returns { vout, current, p1, p2, total }.
 */
export function divider(vin, r1, r2) {
  if (!(vin > 0)) throw new Error('Input voltage must be more than 0.');
  if (!(r1 > 0) || !(r2 > 0)) throw new Error('R1 and R2 must be more than 0.');
  const current = vin / (r1 + r2);
  return {
    vout: tidy(vin * r2 / (r1 + r2)),
    current: tidy(current),
    p1: tidy(current * current * r1),
    p2: tidy(current * current * r2),
    total: tidy(vin * current),
  };
}

/**
 * Finds R2 for a target output voltage, then the nearest E12, E24 and E96 values and the
 * output each one actually gives. Returns { r2, options: [{ series, r2, vout, error }] } (error in %).
 */
export function dividerR2(vin, vout, r1) {
  if (!(vin > 0)) throw new Error('Input voltage must be more than 0.');
  if (!(r1 > 0)) throw new Error('R1 must be more than 0.');
  if (!(vout > 0) || vout >= vin) throw new Error('The target output must be more than 0 and less than the input voltage.');
  const r2 = tidy(r1 * vout / (vin - vout));
  const options = ['E12', 'E24', 'E96'].map((series) => {
    const value = nearestPreferred(r2, series);
    const actual = vin * value / (r1 + value);
    return { series, r2: value, vout: tidy(actual), error: tidy(((actual - vout) / vout) * 100) };
  });
  return { r2, options };
}

// Typical forward voltages at 20 mA. Real parts vary; the datasheet wins.
export const LED_PRESETS = [
  { name: 'Red', vf: 2.0 },
  { name: 'Orange', vf: 2.1 },
  { name: 'Yellow', vf: 2.1 },
  { name: 'Green (classic)', vf: 2.2 },
  { name: 'Green (bright)', vf: 3.0 },
  { name: 'Blue', vf: 3.2 },
  { name: 'White', vf: 3.2 },
  { name: 'Infrared', vf: 1.3 },
];

// Common resistor power ratings in watts.
export const POWER_RATINGS = [0.125, 0.25, 0.5, 1, 2, 3, 5, 10];

/** The smallest common rating at least twice the dissipated power, or null if over 10 W. */
export function recommendedRating(watts) {
  return POWER_RATINGS.find((rating) => rating >= watts * 2) ?? null;
}

/**
 * Series resistor for LEDs. { supply, vf, current (A), count } →
 * { drop, resistance, power, rating, standard, actualCurrent, actualPower }.
 * standard is the next E24 value up, so the current stays at or below the target.
 */
export function ledResistor({ supply, vf, current = 0.02, count = 1 }) {
  if (!(supply > 0)) throw new Error('Supply voltage must be more than 0.');
  if (!(vf > 0)) throw new Error('Forward voltage must be more than 0.');
  if (!(current > 0)) throw new Error('Forward current must be more than 0.');
  if (!Number.isInteger(count) || count < 1) throw new Error('Number of LEDs must be a whole number, 1 or more.');
  const ledDrop = count * vf;
  if (ledDrop >= supply) {
    throw new Error(`${count} LED${count === 1 ? '' : 's'} at ${formatSI(vf, 'V')} need ${formatSI(ledDrop, 'V')}, which is not less than the ${formatSI(supply, 'V')} supply. Use a higher supply or fewer LEDs in series.`);
  }
  const drop = tidy(supply - ledDrop);
  const resistance = tidy(drop / current);
  const power = tidy(drop * current);
  const standard = nearestPreferred(resistance, 'E24', 'up');
  const actualCurrent = tidy(drop / standard);
  const actualPower = tidy(drop * actualCurrent);
  return { drop, resistance, power, rating: recommendedRating(actualPower), standard, actualCurrent, actualPower };
}

/**
 * Parses a list of resistances separated by commas, spaces or new lines.
 * Returns { values } or throws naming the first bad entry.
 */
export function parseList(text) {
  const tokens = String(text ?? '').split(/[\s,;]+/).filter(Boolean);
  if (tokens.length > 1000) throw new Error('That is more than 1000 values. Split the list up.');
  const values = tokens.map((token) => {
    const value = parseSI(token);
    if (Number.isNaN(value)) throw new Error(`"${token}" isn't a value. Use numbers like 100, 4k7 or 1M.`);
    if (value < 0) throw new Error(`"${token}" is negative.`);
    return value;
  });
  return { values };
}

/** Totals for resistors in series and in parallel. Returns { series, parallel, count }. */
export function seriesParallel(values) {
  if (!values.length) throw new Error('Enter at least one value.');
  const series = values.reduce((sum, r) => sum + r, 0);
  // Any 0 Ω branch shorts the parallel combination.
  const parallel = values.some((r) => r === 0) ? 0 : 1 / values.reduce((sum, r) => sum + 1 / r, 0);
  return { series: tidy(series), parallel: tidy(parallel), count: values.length };
}
