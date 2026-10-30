// Color parsing, conversion, contrast and shades. No DOM access, so Node tests can import it.
// Colors are { r, g, b, alpha } with sRGB channels in 0..1.

/** The 148 CSS named colors (CSS Color 4), as 6-digit hex. Aliases like gray/grey are both listed. */
export const NAMED_COLORS = {
  aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4', azure: 'f0ffff',
  beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000', blanchedalmond: 'ffebcd', blue: '0000ff',
  blueviolet: '8a2be2', brown: 'a52a2a', burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00',
  chocolate: 'd2691e', coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c',
  cyan: '00ffff', darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b', darkgray: 'a9a9a9',
  darkgreen: '006400', darkgrey: 'a9a9a9', darkkhaki: 'bdb76b', darkmagenta: '8b008b', darkolivegreen: '556b2f',
  darkorange: 'ff8c00', darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f',
  darkslateblue: '483d8b', darkslategray: '2f4f4f', darkslategrey: '2f4f4f', darkturquoise: '00ced1', darkviolet: '9400d3',
  deeppink: 'ff1493', deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969', dodgerblue: '1e90ff',
  firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'ff00ff', gainsboro: 'dcdcdc',
  ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520', gray: '808080', green: '008000',
  greenyellow: 'adff2f', grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4', indianred: 'cd5c5c',
  indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa', lavenderblush: 'fff0f5',
  lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6', lightcoral: 'f08080', lightcyan: 'e0ffff',
  lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3', lightgreen: '90ee90', lightgrey: 'd3d3d3', lightpink: 'ffb6c1',
  lightsalmon: 'ffa07a', lightseagreen: '20b2aa', lightskyblue: '87cefa', lightslategray: '778899', lightslategrey: '778899',
  lightsteelblue: 'b0c4de', lightyellow: 'ffffe0', lime: '00ff00', limegreen: '32cd32', linen: 'faf0e6',
  magenta: 'ff00ff', maroon: '800000', mediumaquamarine: '66cdaa', mediumblue: '0000cd', mediumorchid: 'ba55d3',
  mediumpurple: '9370db', mediumseagreen: '3cb371', mediumslateblue: '7b68ee', mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc',
  mediumvioletred: 'c71585', midnightblue: '191970', mintcream: 'f5fffa', mistyrose: 'ffe4e1', moccasin: 'ffe4b5',
  navajowhite: 'ffdead', navy: '000080', oldlace: 'fdf5e6', olive: '808000', olivedrab: '6b8e23',
  orange: 'ffa500', orangered: 'ff4500', orchid: 'da70d6', palegoldenrod: 'eee8aa', palegreen: '98fb98',
  paleturquoise: 'afeeee', palevioletred: 'db7093', papayawhip: 'ffefd5', peachpuff: 'ffdab9', peru: 'cd853f',
  pink: 'ffc0cb', plum: 'dda0dd', powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399',
  red: 'ff0000', rosybrown: 'bc8f8f', royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072',
  sandybrown: 'f4a460', seagreen: '2e8b57', seashell: 'fff5ee', sienna: 'a0522d', silver: 'c0c0c0',
  skyblue: '87ceeb', slateblue: '6a5acd', slategray: '708090', slategrey: '708090', snow: 'fffafa',
  springgreen: '00ff7f', steelblue: '4682b4', tan: 'd2b48c', teal: '008080', thistle: 'd8bfd8',
  tomato: 'ff6347', turquoise: '40e0d0', violet: 'ee82ee', wheat: 'f5deb3', white: 'ffffff',
  whitesmoke: 'f5f5f5', yellow: 'ffff00', yellowgreen: '9acd32',
};

const MAX_INPUT = 200;
// A channel this far outside 0..1 still counts as in gamut (half an 8-bit step), so rounding noise isn't flagged.
const GAMUT_EPS = 0.5 / 255;

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const mod360 = (h) => ((h % 360) + 360) % 360;
/** Rounds to `digits` decimals and drops trailing zeros: fmt(0.50, 2) → "0.5". */
const fmt = (n, digits) => {
  const s = String(Number(n.toFixed(digits)));
  return s === '-0' ? '0' : s;
};

// ---------- Color space math ----------

const toLinear = (c) => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (Math.abs(c) <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055));

/** sRGB (0..1) → OKLab { L, a, b }. Matrices from Björn Ottosson's reference implementation. */
export function rgbToOklab({ r, g, b }) {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** OKLab → sRGB (0..1), unclamped, so out-of-gamut colors have channels outside 0..1. */
export function oklabToRgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/** OKLab → OKLCH { L, C, h }. Hue is 0 for achromatic colors. */
export function oklabToOklch({ L, a, b }) {
  const C = Math.hypot(a, b);
  return { L, C, h: C < 1e-4 ? 0 : mod360((Math.atan2(b, a) * 180) / Math.PI) };
}

export function oklchToOklab({ L, C, h }) {
  const rad = (h * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

/** sRGB (0..1) → { h, s, l } with s and l in 0..1. */
export function rgbToHsl({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: mod360(h * 60), s, l };
}

export function hslToRgb({ h, s, l }) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  h = mod360(h);
  return { r: f(0), g: f(8), b: f(4) };
}

/** sRGB (0..1) → { h, w, b } with whiteness and blackness in 0..1. */
export function rgbToHwb(rgb) {
  const { h } = rgbToHsl(rgb);
  return { h, w: Math.min(rgb.r, rgb.g, rgb.b), b: 1 - Math.max(rgb.r, rgb.g, rgb.b) };
}

export function hwbToRgb({ h, w, b }) {
  if (w + b >= 1) {
    const gray = w / (w + b);
    return { r: gray, g: gray, b: gray };
  }
  const base = hslToRgb({ h, s: 1, l: 0.5 });
  const scale = (c) => c * (1 - w - b) + w;
  return { r: scale(base.r), g: scale(base.g), b: scale(base.b) };
}

const inGamut = ({ r, g, b }) => [r, g, b].every((c) => c >= -GAMUT_EPS && c <= 1 + GAMUT_EPS);

/**
 * Converts OKLCH to sRGB, reducing chroma (keeping lightness and hue) until it fits.
 * Returns { rgb, mapped } where mapped says whether chroma had to be reduced.
 */
export function oklchToRgbMapped({ L, C, h }) {
  L = clamp(L);
  C = Math.max(0, C);
  if (L >= 1) return { rgb: { r: 1, g: 1, b: 1 }, mapped: C > 1e-4 };
  if (L <= 0) return { rgb: { r: 0, g: 0, b: 0 }, mapped: C > 1e-4 };
  const at = (chroma) => oklabToRgb(oklchToOklab({ L, C: chroma, h }));
  let rgb = at(C);
  if (inGamut(rgb)) return { rgb: clampRgb(rgb), mapped: false };
  let lo = 0;
  let hi = C;
  while (hi - lo > 1e-6) {
    const mid = (lo + hi) / 2;
    if (inGamut(at(mid))) lo = mid;
    else hi = mid;
  }
  rgb = at(lo);
  return { rgb: clampRgb(rgb), mapped: true };
}

const clampRgb = ({ r, g, b }) => ({ r: clamp(r), g: clamp(g), b: clamp(b) });

// ---------- Parsing ----------

const TOKEN = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/i;

function parseToken(raw, what) {
  if (/^none$/i.test(raw)) return { value: 0, unit: '' };
  const match = TOKEN.exec(raw);
  if (!match) throw new Error(`"${raw}" isn't a valid ${what}.`);
  return { value: Number(match[1]), unit: (match[2] || '').toLowerCase() };
}

function hue(raw) {
  const { value, unit } = parseToken(raw, 'hue');
  if (unit === '%') throw new Error(`Hue "${raw}" can't be a percentage. Use degrees, like 120 or 120deg.`);
  const factor = { '': 1, deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 }[unit];
  return mod360(value * factor);
}

/** A number or percentage; percentages scale so that 100% equals `full`. */
function amount(raw, what, full) {
  const { value, unit } = parseToken(raw, what);
  if (unit && unit !== '%') throw new Error(`"${raw}" can't have a unit here.`);
  return unit === '%' ? (value / 100) * full : value;
}

function alphaOf(raw) {
  if (raw == null) return 1;
  return clamp(amount(raw, 'alpha value', 1));
}

/** Splits "a b c / d" or "a, b, c, d" into channel tokens and an alpha token. */
function splitArgs(body, fn) {
  const text = body.trim();
  let parts;
  let alpha;
  if (text.includes(',')) {
    if (text.includes('/')) throw new Error('Mix of commas and "/" in the arguments. Use one syntax.');
    parts = text.split(',').map((p) => p.trim());
    if (parts.some((p) => !p)) throw new Error(`Empty value in ${fn}().`);
    if (parts.length === 4) alpha = parts.pop();
  } else {
    const [main, extra, ...rest] = text.split('/');
    if (rest.length) throw new Error('Only one "/" is allowed, before the alpha value.');
    parts = main.trim().split(/\s+/).filter(Boolean);
    if (extra !== undefined) {
      alpha = extra.trim();
      if (!alpha) throw new Error('Missing alpha value after "/".');
    }
  }
  if (parts.length !== 3) throw new Error(`${fn}() needs 3 values${parts.length > 3 ? '' : ' plus an optional alpha'}, found ${parts.length}.`);
  return { parts, alpha };
}

function parseHex(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
  const byte = (i) => parseInt(full.slice(i * 2, i * 2 + 2), 16);
  return { r: byte(0) / 255, g: byte(1) / 255, b: byte(2) / 255, alpha: full.length === 8 ? byte(3) / 255 : 1 };
}

/**
 * Parses any supported CSS color: hex (3, 4, 6 or 8 digits, "#" optional), rgb()/rgba(),
 * hsl()/hsla(), hwb(), oklch(), oklab() (comma or space syntax), the CSS named colors and "transparent".
 * Returns { r, g, b, alpha, format, mapped }: sRGB channels 0..1; mapped is true when an out-of-gamut
 * OKLCH/OKLab color had its chroma reduced. Throws an Error with a plain message for bad input.
 */
export function parseColor(input) {
  const text = String(input ?? '').trim().toLowerCase();
  if (!text) throw new Error('Enter a color, like #3b82f6, rgb(59 130 246) or rebeccapurple.');
  if (text.length > MAX_INPUT) throw new Error('That is too long to be a color.');

  if (text === 'transparent') return { r: 0, g: 0, b: 0, alpha: 0, format: 'named', mapped: false };
  if (Object.hasOwn(NAMED_COLORS, text)) return { ...parseHex(NAMED_COLORS[text]), format: 'named', mapped: false };

  const bare = text.startsWith('#') ? text.slice(1) : text;
  const hex = parseHex(bare);
  if (hex) return { ...hex, format: 'hex', mapped: false };
  if (text.startsWith('#')) throw new Error('Hex colors need 3, 4, 6 or 8 digits from 0-9 and a-f.');

  const fnMatch = /^([a-z]+)\(([^()]*)\)$/.exec(text);
  if (!fnMatch) {
    if (/^[a-z]+$/.test(text)) throw new Error(`"${text}" isn't a CSS color name.`);
    throw new Error('Not a color this tool understands. Try hex, rgb(), hsl(), hwb(), oklch(), oklab() or a name.');
  }
  const [, fn, body] = fnMatch;
  const { parts, alpha: alphaRaw } = splitArgs(body, fn);
  const alpha = alphaOf(alphaRaw);
  let rgb;
  let mapped = false;
  let format = fn;

  switch (fn) {
    case 'rgb':
    case 'rgba': {
      format = 'rgb';
      rgb = Object.fromEntries(['r', 'g', 'b'].map((key, i) => [key, clamp(amount(parts[i], 'channel value', 255) / 255)]));
      break;
    }
    case 'hsl':
    case 'hsla': {
      format = 'hsl';
      rgb = hslToRgb({ h: hue(parts[0]), s: clamp(amount(parts[1], 'saturation', 100) / 100), l: clamp(amount(parts[2], 'lightness', 100) / 100) });
      break;
    }
    case 'hwb': {
      rgb = hwbToRgb({ h: hue(parts[0]), w: clamp(amount(parts[1], 'whiteness', 100) / 100), b: clamp(amount(parts[2], 'blackness', 100) / 100) });
      break;
    }
    case 'oklch': {
      const L = amount(parts[0], 'lightness', 1);
      const C = amount(parts[1], 'chroma', 0.4);
      ({ rgb, mapped } = oklchToRgbMapped({ L, C, h: hue(parts[2]) }));
      break;
    }
    case 'oklab': {
      const lch = oklabToOklch({ L: amount(parts[0], 'lightness', 1), a: amount(parts[1], 'a value', 0.4), b: amount(parts[2], 'b value', 0.4) });
      ({ rgb, mapped } = oklchToRgbMapped(lch));
      break;
    }
    default:
      throw new Error(`${fn}() isn't supported. Try rgb(), hsl(), hwb(), oklch() or oklab().`);
  }
  return { ...rgb, alpha, format, mapped };
}

// ---------- Formatting ----------

const byte = (c) => Math.round(clamp(c) * 255);
const hex2 = (n) => n.toString(16).padStart(2, '0');
const alphaSuffix = (alpha) => (alpha < 1 ? ` / ${fmt(alpha, 3)}` : '');

/** "#rrggbb", ignoring alpha. */
export const toHex = (c) => `#${hex2(byte(c.r))}${hex2(byte(c.g))}${hex2(byte(c.b))}`;
/** "#rrggbbaa". */
export const toHexAlpha = (c) => `${toHex(c)}${hex2(byte(c.alpha ?? 1))}`;

export const toRgbString = (c) => `rgb(${byte(c.r)} ${byte(c.g)} ${byte(c.b)}${alphaSuffix(c.alpha ?? 1)})`;

export function toHslString(c) {
  const { h, s, l } = rgbToHsl(c);
  return `hsl(${fmt(h, 1) === '360' ? '0' : fmt(h, 1)} ${fmt(s * 100, 1)}% ${fmt(l * 100, 1)}%${alphaSuffix(c.alpha ?? 1)})`;
}

export function toHwbString(c) {
  const { h, w, b } = rgbToHwb(c);
  return `hwb(${fmt(h, 1) === '360' ? '0' : fmt(h, 1)} ${fmt(w * 100, 1)}% ${fmt(b * 100, 1)}%${alphaSuffix(c.alpha ?? 1)})`;
}

export function toOklchString(c) {
  const { L, C, h } = oklabToOklch(rgbToOklab(c));
  const chroma = C < 5e-5 ? 0 : C;
  const hueText = chroma === 0 ? '0' : fmt(h, 2) === '360' ? '0' : fmt(h, 2);
  return `oklch(${fmt(L, 3)} ${fmt(chroma, 4)} ${hueText}${alphaSuffix(c.alpha ?? 1)})`;
}

export function toOklabString(c) {
  const { L, a, b } = rgbToOklab(c);
  return `oklab(${fmt(L, 3)} ${fmt(a, 4)} ${fmt(b, 4)}${alphaSuffix(c.alpha ?? 1)})`;
}

/** The CSS names for this exact opaque color, e.g. ['aqua', 'cyan'], or [] when there is none. */
export function namesOf(c) {
  if ((c.alpha ?? 1) < 1) return (c.alpha ?? 1) === 0 && toHex(c) === '#000000' ? ['transparent'] : [];
  const hex = toHex(c).slice(1);
  return Object.keys(NAMED_COLORS).filter((name) => NAMED_COLORS[name] === hex);
}

/** Every output format for a parsed color. hexAlpha is null when the color is opaque. */
export function formatAll(c) {
  const alpha = c.alpha ?? 1;
  return {
    hex: toHex(c),
    hexAlpha: alpha < 1 ? toHexAlpha(c) : null,
    rgb: toRgbString(c),
    hsl: toHslString(c),
    hwb: toHwbString(c),
    oklch: toOklchString(c),
    oklab: toOklabString(c),
    names: namesOf(c),
  };
}

// ---------- Contrast ----------

/** WCAG 2 relative luminance of an sRGB color. */
export function luminance({ r, g, b }) {
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Paints `top` (with its alpha) over an opaque `bottom`. */
export function composite(top, bottom) {
  const a = top.alpha ?? 1;
  const mix = (t, b) => t * a + b * (1 - a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), alpha: 1 };
}

const WHITE = { r: 1, g: 1, b: 1, alpha: 1 };

/** WCAG 2 contrast ratio (1..21). A translucent background sits on white; a translucent text color sits on the background. */
export function contrastRatio(fg, bg) {
  const back = composite(bg, WHITE);
  const front = composite(fg, back);
  const l1 = luminance(front);
  const l2 = luminance(back);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** WCAG 2.x thresholds, compared without rounding the ratio (4.499 fails AA). */
export const WCAG_LEVELS = [
  { id: 'aa', label: 'AA', min: 4.5, note: 'Normal text' },
  { id: 'aa-large', label: 'AA large', min: 3, note: 'Text 24px, or 18.66px bold' },
  { id: 'aaa', label: 'AAA', min: 7, note: 'Normal text' },
  { id: 'aaa-large', label: 'AAA large', min: 4.5, note: 'Text 24px, or 18.66px bold' },
  { id: 'ui', label: 'UI components', min: 3, note: 'Icons, borders, focus rings' },
];

/** Contrast ratio plus pass/fail for each WCAG level. ratioText is truncated, so 4.499 never shows as 4.50. */
export function checkContrast(fg, bg) {
  const ratio = contrastRatio(fg, bg);
  return {
    ratio,
    ratioText: `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`,
    levels: WCAG_LEVELS.map((level) => ({ ...level, pass: ratio >= level.min })),
  };
}

// ---------- Shades ----------

export const SHADE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const SHADE_LIGHTNESS = [0.97, 0.93, 0.87, 0.79, 0.71, 0.63, 0.55, 0.47, 0.39, 0.3, 0.22];

/**
 * An 11-step tint/shade scale: the color's OKLCH chroma and hue at fixed lightness steps,
 * gamut-mapped into sRGB. Returns [{ step, L, hex, color }].
 */
export function shades(c) {
  const { C, h } = oklabToOklch(rgbToOklab(c));
  return SHADE_STEPS.map((step, i) => {
    const L = SHADE_LIGHTNESS[i];
    const { rgb } = oklchToRgbMapped({ L, C, h });
    const color = { ...rgb, alpha: 1 };
    return { step, L, hex: toHex(color), color };
  });
}

/** Index of the shade step closest in lightness to the color. */
export function nearestShade(c) {
  const { L } = rgbToOklab(c);
  let best = 0;
  SHADE_LIGHTNESS.forEach((value, i) => {
    if (Math.abs(value - L) < Math.abs(SHADE_LIGHTNESS[best] - L)) best = i;
  });
  return best;
}
