// Resistor color code logic (IEC 60062). No DOM access, so Node tests can import it.
import { formatSI, parseSI } from '../../assets/units.js';
import { nearestPreferred, seriesContaining } from '../../assets/eseries.js';

/**
 * Every band color with what it means in each position. `hex` is the drawing color.
 * tempco is in ppm/K, per IEC 60062:2016.
 */
export const COLORS = [
  { name: 'black', hex: '#1b1b1b', digit: 0, multiplier: 1, tolerance: null, tempco: 250 },
  { name: 'brown', hex: '#7a4a24', digit: 1, multiplier: 10, tolerance: 1, tempco: 100 },
  { name: 'red', hex: '#d42a2a', digit: 2, multiplier: 100, tolerance: 2, tempco: 50 },
  { name: 'orange', hex: '#f07c12', digit: 3, multiplier: 1e3, tolerance: null, tempco: 15 },
  { name: 'yellow', hex: '#f5d020', digit: 4, multiplier: 1e4, tolerance: null, tempco: 25 },
  { name: 'green', hex: '#2b9a44', digit: 5, multiplier: 1e5, tolerance: 0.5, tempco: 20 },
  { name: 'blue', hex: '#2560d0', digit: 6, multiplier: 1e6, tolerance: 0.25, tempco: 10 },
  { name: 'violet', hex: '#8a3fc8', digit: 7, multiplier: 1e7, tolerance: 0.1, tempco: 5 },
  { name: 'grey', hex: '#8a8a8a', digit: 8, multiplier: 1e8, tolerance: 0.05, tempco: 1 },
  { name: 'white', hex: '#f4f4f4', digit: 9, multiplier: 1e9, tolerance: null, tempco: null },
  { name: 'gold', hex: '#c9a032', digit: null, multiplier: 0.1, tolerance: 5, tempco: null },
  { name: 'silver', hex: '#b9bcc0', digit: null, multiplier: 0.01, tolerance: 10, tempco: null },
  // "none" is the missing fourth band of a ±20% resistor (4-band only).
  { name: 'none', hex: null, digit: null, multiplier: null, tolerance: 20, tempco: null },
];

const BY_NAME = new Map(COLORS.map((color) => [color.name, color]));
export const colorByName = (name) => BY_NAME.get(String(name).toLowerCase()) || null;

/** The role of each band position for a 4, 5 or 6 band resistor. */
export function bandRoles(count) {
  if (count === 4) return ['digit', 'digit', 'multiplier', 'tolerance'];
  if (count === 5) return ['digit', 'digit', 'digit', 'multiplier', 'tolerance'];
  if (count === 6) return ['digit', 'digit', 'digit', 'multiplier', 'tolerance', 'tempco'];
  throw new Error('Resistors have 4, 5 or 6 bands.');
}

/** Colors that are valid for a role. Tolerance "none" (±20%) only exists on 4-band resistors. */
export function optionsFor(role, count = 4) {
  return COLORS.filter((color) => {
    if (role === 'tolerance' && color.name === 'none') return count === 4;
    return color[role] != null;
  });
}

/** Human label for a band position, e.g. "Band 3: multiplier". */
export function roleLabel(role, index, count) {
  const ordinal = ['First', 'Second', 'Third'];
  const what = role === 'digit' ? `${ordinal[index].toLowerCase()} digit` : role === 'tempco' ? 'temperature coefficient' : role;
  return `Band ${index + 1}: ${what}`;
}

/** Tolerances (in %) that a band count can show, tightest first. */
export function tolerancesFor(count) {
  return optionsFor('tolerance', count).map((color) => color.tolerance).sort((a, b) => a - b);
}

const clean = (value) => Number(value.toPrecision(12));

/**
 * Reads a list of band colors. Returns { ohms, tolerance, tempco, min, max }.
 * Throws when a color isn't valid in its position.
 */
export function decodeBands(bands) {
  const roles = bandRoles(bands.length);
  let digits = 0;
  let multiplier = 1;
  let tolerance = null;
  let tempco = null;
  roles.forEach((role, i) => {
    const color = colorByName(bands[i]);
    if (!color || color[role] == null || (role === 'tolerance' && color.name === 'none' && bands.length !== 4)) {
      throw new Error(`${bands[i]} can't be ${roleLabel(role, i, bands.length).toLowerCase()}.`);
    }
    if (role === 'digit') digits = digits * 10 + color.digit;
    else if (role === 'multiplier') multiplier = color.multiplier;
    else if (role === 'tolerance') tolerance = color.tolerance;
    else tempco = color.tempco;
  });
  const ohms = clean(digits * multiplier);
  return {
    ohms,
    tolerance,
    tempco,
    min: clean(ohms * (1 - tolerance / 100)),
    max: clean(ohms * (1 + tolerance / 100)),
  };
}

/** "4.7 kΩ ±5%" (plus the tempco when there is one). */
export function describeValue({ ohms, tolerance, tempco }) {
  const base = `${formatSI(ohms, 'Ω')} ±${tolerance}%`;
  return tempco == null ? base : `${base} ${tempco} ppm/K`;
}

/** "4.465 kΩ – 4.935 kΩ" */
export const describeRange = ({ min, max }) => `${formatSI(min, 'Ω', { digits: 7 })} – ${formatSI(max, 'Ω', { digits: 7 })}`;

/** Series (E6…E192) that contain the value exactly. */
export const seriesFor = (ohms) => seriesContaining(ohms);

/**
 * Parses a resistance like "4k7", "470R", "1M", "4.7 kΩ". Returns { ok: true, value } or { ok: false, error }.
 */
export function parseResistance(text) {
  const s = String(text ?? '').trim();
  if (!s) return { ok: false, error: 'Enter a resistance, like 4k7, 470R or 1M.' };
  const value = parseSI(s);
  if (Number.isNaN(value)) return { ok: false, error: `"${s}" isn't a resistance. Try 4k7, 470R or 1M.` };
  if (value < 0) return { ok: false, error: 'Resistance can’t be negative.' };
  if (value === 0) return { ok: false, error: 'A 0 Ω link has a single black band.' };
  return { ok: true, value };
}

// Splits a value into significant digits and a multiplier exponent (−2 … 9), or null if it can't be.
function split(ohms, digitCount) {
  const limit = 10 ** digitCount;
  for (let exponent = -2; exponent <= 9; exponent++) {
    const n = ohms / 10 ** exponent;
    if (n >= limit) continue;
    const rounded = Math.round(n);
    if (rounded > 0 && Math.abs(n - rounded) <= 1e-9 * Math.max(1, n)) return { n: rounded, exponent };
    // Smaller exponents give more digits; once the value fits, a larger exponent can only lose precision.
    return null;
  }
  return null;
}

const MULTIPLIER_BY_EXPONENT = new Map(COLORS.filter((c) => c.multiplier != null).map((c) => [Math.round(Math.log10(c.multiplier)), c.name]));
const DIGIT_COLORS = COLORS.filter((c) => c.digit != null).map((c) => c.name);

/**
 * Finds the bands for a resistance. options: { count: 4|5|6, tolerance: %, tempco: ppm/K (6-band) }.
 * When the value needs more significant digits than the bands have, it uses the nearest standard
 * value (E24 for 4 bands, E96 or E192 for 5–6 bands). Returns { bands, ohms, exact, series }.
 */
export function encodeValue(ohms, { count = 4, tolerance = 5, tempco = 100 } = {}) {
  bandRoles(count);
  const digitCount = count === 4 ? 2 : 3;
  const maxValue = (10 ** digitCount - 1) * 1e9;
  if (!(ohms > 0) || !Number.isFinite(ohms)) throw new Error('Enter a resistance above 0 Ω.');
  if (ohms < 0.01 * (1 - 1e-9)) throw new Error('Color bands can’t show values below 0.01 Ω.');
  if (ohms > maxValue * (1 + 1e-9)) throw new Error(`${count} bands can show at most ${formatSI(maxValue, 'Ω')}.`);

  const toleranceColor = optionsFor('tolerance', count).find((c) => c.tolerance === tolerance);
  if (!toleranceColor) {
    throw new Error(`${count}-band resistors don't come in ±${tolerance}%. Pick one of ${tolerancesFor(count).map((t) => `±${t}%`).join(', ')}.`);
  }
  let tempcoColor = null;
  if (count === 6) {
    tempcoColor = optionsFor('tempco').find((c) => c.tempco === tempco);
    if (!tempcoColor) throw new Error(`There is no tempco band for ${tempco} ppm/K.`);
  }

  let parts = split(ohms, digitCount);
  let value = ohms;
  let exact = true;
  let series = null;
  if (!parts) {
    exact = false;
    series = count === 4 ? 'E24' : tolerance < 1 ? 'E192' : 'E96';
    value = nearestPreferred(ohms, series);
    if (value > maxValue) value = nearestPreferred(ohms, series, 'down');
    if (value < 0.01) value = nearestPreferred(ohms, series, 'up');
    parts = split(value, digitCount);
    // Below 0.1 Ω the smallest multiplier (silver) sets the resolution, so round to it.
    if (!parts) {
      series = null;
      value = clean(Math.max(1, Math.round(ohms * 100)) / 100);
      parts = split(value, digitCount);
    }
  }
  const digitBands = String(parts.n).padStart(digitCount, '0').split('').map((d) => DIGIT_COLORS[Number(d)]);
  const bands = [...digitBands, MULTIPLIER_BY_EXPONENT.get(parts.exponent), toleranceColor.name];
  if (tempcoColor) bands.push(tempcoColor.name);
  return { bands, ohms: clean(value), exact, series };
}
