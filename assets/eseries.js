// IEC 60063 preferred-number series (resistor and capacitor values), as mantissas in [1, 10).
// Pure: safe to import from logic modules and Node tests.

// E48 and up follow round(10^(i/n), 3 significant figures); E192 has one historical exception (9.20).
const generated = (n) => Array.from({ length: n }, (_, i) => Math.round(10 ** (i / n) * 100) / 100);

export const SERIES = {
  E6: [1.0, 1.5, 2.2, 3.3, 4.7, 6.8],
  E12: [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2],
  E24: [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1],
  E48: generated(48),
  E96: generated(96),
  E192: generated(192).map((value) => (value === 9.19 ? 9.2 : value)),
};

// Tolerance each series is normally sold in.
export const SERIES_TOLERANCE = { E6: 20, E12: 10, E24: 5, E48: 2, E96: 1, E192: 0.5 };

const clean = (value) => Number(value.toPrecision(12));

function candidates(value, series) {
  const list = SERIES[series];
  if (!list) throw new Error(`Unknown series "${series}"`);
  const decade = Math.floor(Math.log10(value));
  const out = [];
  for (const exponent of [decade - 1, decade, decade + 1]) {
    for (const mantissa of list) out.push(clean(mantissa * 10 ** exponent));
  }
  return out;
}

/**
 * Finds the preferred value closest to `value` in a series.
 * mode: 'nearest' (smallest ratio error), 'up' (smallest value ≥ input) or 'down' (largest value ≤ input).
 * Returns NaN for zero, negative or non-finite input.
 */
export function nearestPreferred(value, series = 'E24', mode = 'nearest') {
  if (!(value > 0) || !Number.isFinite(value)) return NaN;
  const list = candidates(value, series);
  const eps = 1e-9;
  if (mode === 'up') return Math.min(...list.filter((c) => c >= value * (1 - eps)));
  if (mode === 'down') return Math.max(...list.filter((c) => c <= value * (1 + eps)));
  let best = list[0];
  for (const c of list) {
    if (Math.abs(Math.log(c / value)) < Math.abs(Math.log(best / value))) best = c;
  }
  return best;
}

/** Lists the series that contain `value` exactly (e.g. 4700 → ['E6', 'E12', 'E24', 'E192']). */
export function seriesContaining(value) {
  if (!(value > 0) || !Number.isFinite(value)) return [];
  const mantissa = clean(value / 10 ** Math.floor(Math.log10(value)));
  return Object.keys(SERIES).filter((name) => SERIES[name].some((m) => Math.abs(m - mantissa) < 1e-9));
}
