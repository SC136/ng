// Engineering-notation parsing and formatting. Pure: safe to import from logic modules and Node tests.

const PREFIX = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
const FORMAT_STEPS = [
  [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
  [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'],
];
// Unit words that may trail a value. "meg" is SPICE for mega and is handled separately.
const UNIT_SUFFIX = /(ohms?|Ω|Hz|Ah|V|A|W|F|H)$/i;
const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?';
const WITH_PREFIX = new RegExp(`^(${NUMBER})(meg|[pnuµμmkKMGTR])?$`, 'i');
const RKM = /^([-+]?)(\d*)([pnuµμmkKMGTR])(\d+)$/;

// Removes floating-point noise such as 2.2 * 1e-6 = 0.0000022000000000000003.
const tidy = (value) => Number(value.toPrecision(15));

/**
 * Parses an engineering value: "4.7k", "4k7", "470R", "R47", "2.2µF", "2u2", "20mA", "1M", "1meg", "1e-3".
 * As in electronics, "M" is mega and "m" is milli. A trailing unit (Ω, ohm, V, A, W, F, H, Hz, Ah) is ignored.
 * Thousands separators like "1,000" are accepted. Returns NaN when the text isn't a value.
 */
export function parseSI(text) {
  let s = String(text ?? '').trim().replace(/[\s_]+/g, '');
  if (!s) return NaN;
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?/.test(s)) s = s.replace(/,/g, '');
  const withoutUnit = s.replace(UNIT_SUFFIX, '');
  // Keep the unit-stripped form only if something is left ("A" alone is not a value).
  if (withoutUnit && withoutUnit !== s && /\d/.test(withoutUnit)) s = withoutUnit;

  const rkm = RKM.exec(s);
  if (rkm) {
    const [, sign, whole, letter, fraction] = rkm;
    const factor = letter === 'R' || letter === 'r' ? 1 : PREFIX[letter];
    if (factor === undefined) return NaN;
    return tidy(Number(`${sign}${whole || '0'}.${fraction}`) * factor);
  }

  const match = WITH_PREFIX.exec(s);
  if (!match) return NaN;
  const [, number, prefix] = match;
  if (!prefix) return tidy(Number(number));
  if (prefix.toLowerCase() === 'meg') return tidy(Number(number) * 1e6);
  if (prefix === 'R' || prefix === 'r') return tidy(Number(number));
  const factor = PREFIX[prefix];
  return factor === undefined ? NaN : tidy(Number(number) * factor);
}

/**
 * Formats a value with an SI prefix: formatSI(4700, 'Ω') → "4.7 kΩ", formatSI(0.02, 'A') → "20 mA".
 * digits is the number of significant digits kept (trailing zeros are dropped).
 */
export function formatSI(value, unit = '', { digits = 4 } = {}) {
  if (Number.isNaN(value) || value == null) return '—';
  if (!Number.isFinite(value)) return `${value < 0 ? '-' : ''}∞${unit ? ` ${unit}` : ''}`;
  if (value === 0) return `0${unit ? ` ${unit}` : ''}`;
  const abs = Math.abs(value);
  let index = FORMAT_STEPS.findIndex(([factor]) => abs >= factor * (1 - 1e-12));
  if (index === -1) index = FORMAT_STEPS.length - 1;
  let [factor, prefix] = FORMAT_STEPS[index];
  let scaled = Number((value / factor).toPrecision(digits));
  // Rounding can carry into the next prefix: 999.96k → 1000k → 1M.
  if (Math.abs(scaled) >= 1000 && index > 0) {
    [factor, prefix] = FORMAT_STEPS[index - 1];
    scaled = Number((value / factor).toPrecision(digits));
  }
  return `${scaled} ${prefix}${unit}`.trim();
}

/** Formats a byte count: 0 B, 980 B, 1.21 KB, 34.5 MB (binary multiples, 1 KB = 1024 B). */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Math.abs(bytes);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  const shown = unit === 0 ? String(size) : size.toFixed(size < 10 ? 2 : size < 100 ? 1 : 0);
  return `${bytes < 0 ? '-' : ''}${shown} ${units[unit]}`;
}
