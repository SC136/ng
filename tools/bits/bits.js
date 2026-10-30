// Integer bases, two's complement and IEEE-754 floats. No DOM access, so Node tests can import it.

export const WIDTHS = [8, 16, 32, 64, 128];
const MAX_DIGITS = 4096;
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const PREFIXES = { '0x': 16, '0b': 2, '0o': 8 };
const BASE_NAMES = { 2: 'binary', 8: 'octal', 10: 'decimal', 16: 'hex' };

const baseName = (base) => BASE_NAMES[base] || `base ${base}`;

/**
 * Parses an integer as a BigInt. base is 'auto' (0x, 0b, 0o prefixes, otherwise decimal) or 2–36.
 * A leading + or - is allowed, and spaces, underscores and commas may separate digits.
 * A matching prefix is also accepted with an explicit base (0xff with base 16).
 * Returns { value, base }. Throws an Error with a plain message for bad input.
 */
export function parseInteger(input, base = 'auto') {
  let text = String(input ?? '').trim().toLowerCase();
  if (!text) throw new Error('Enter a number.');
  if (base !== 'auto' && !(Number.isInteger(base) && base >= 2 && base <= 36)) {
    throw new Error('The base must be a whole number from 2 to 36.');
  }
  let negative = false;
  if (text[0] === '-' || text[0] === '+') {
    negative = text[0] === '-';
    text = text.slice(1).trimStart();
  }
  const prefix = PREFIXES[text.slice(0, 2)];
  let radix = base === 'auto' ? 10 : base;
  if (prefix && (base === 'auto' || base === prefix)) {
    radix = prefix;
    text = text.slice(2);
  }
  const digits = text.replace(/[\s_,]/g, '');
  if (!digits) throw new Error('There are no digits after the sign or prefix.');
  if (digits.length > MAX_DIGITS) throw new Error(`That has more than ${MAX_DIGITS} digits, which is too long to show here.`);
  let value = 0n;
  const big = BigInt(radix);
  for (let i = 0; i < digits.length; i++) {
    const digit = DIGITS.indexOf(digits[i]);
    if (digit === -1 || digit >= radix) {
      const hint = base === 'auto' && /^[0-9a-f]+$/.test(digits) ? ' For hex, start with 0x or pick base 16.' : '';
      throw new Error(`"${digits[i]}" isn't a ${baseName(radix)} digit.${hint}`);
    }
    value = value * big + BigInt(digit);
  }
  return { value: negative ? -value : value, base: radix };
}

/** BigInt to text in a base (2–36), lower case, with "-" for negatives. */
export const toBase = (value, base) => value.toString(base);

/** Groups digits from the right: groupDigits('11110000', 4) → '1111 0000'. A leading "-" is kept apart. */
export function groupDigits(text, size, separator = ' ') {
  const negative = text.startsWith('-');
  const digits = negative ? text.slice(1) : text;
  const groups = [];
  for (let end = digits.length; end > 0; end -= size) groups.unshift(digits.slice(Math.max(0, end - size), end));
  return (negative ? '-' : '') + groups.join(separator);
}

/**
 * Two's complement view of a value at a bit width. Returns { pattern, unsigned, signed, fits,
 * fitsSigned, fitsUnsigned, min, max, umax }: pattern is the low `width` bits as an unsigned BigInt.
 * fits is false when the value fits neither the signed nor the unsigned range (it overflowed).
 */
export function twosComplement(value, width) {
  const pattern = BigInt.asUintN(width, value);
  const min = -(1n << BigInt(width - 1));
  const max = (1n << BigInt(width - 1)) - 1n;
  const umax = (1n << BigInt(width)) - 1n;
  const fitsSigned = value >= min && value <= max;
  const fitsUnsigned = value >= 0n && value <= umax;
  return {
    pattern,
    unsigned: pattern,
    signed: BigInt.asIntN(width, value),
    fits: fitsSigned || fitsUnsigned,
    fitsSigned,
    fitsUnsigned,
    min,
    max,
    umax,
  };
}

/** The smallest width in WIDTHS that holds the value (signed or unsigned), or null. */
export function smallestWidth(value) {
  return WIDTHS.find((width) => twosComplement(value, width).fits) ?? null;
}

/** Bits of a pattern, most significant first, as an array of 0/1 numbers. */
export function bitsOf(pattern, width) {
  const out = new Array(width);
  for (let i = 0; i < width; i++) out[width - 1 - i] = Number((pattern >> BigInt(i)) & 1n);
  return out;
}

/** Flips bit `index` (0 = least significant) of a pattern, staying within `width` bits. */
export const toggleBit = (pattern, index, width) => BigInt.asUintN(width, pattern ^ (1n << BigInt(index)));

/** Bytes of a pattern, big-endian (most significant byte first). */
export function bytesOf(pattern, width) {
  const count = width / 8;
  const out = new Array(count);
  for (let i = 0; i < count; i++) out[count - 1 - i] = Number((pattern >> BigInt(i * 8)) & 0xffn);
  return out;
}

/** Number of set bits. */
export function popcount(pattern) {
  let count = 0;
  for (let v = pattern; v > 0n; v >>= 1n) count += Number(v & 1n);
  return count;
}

/** Leading zeros within `width` bits (width for 0). */
export function leadingZeros(pattern, width) {
  if (pattern === 0n) return width;
  return width - pattern.toString(2).length;
}

/** Trailing zeros within `width` bits (width for 0). */
export function trailingZeros(pattern, width) {
  if (pattern === 0n) return width;
  let count = 0;
  for (let v = pattern; (v & 1n) === 0n; v >>= 1n) count++;
  return count;
}

// ---------- IEEE-754 ----------

/** Layouts: total bits, exponent bits, mantissa (fraction) bits, exponent bias. */
export const FLOATS = {
  f32: { id: 'f32', label: 'float32', bits: 32, exponentBits: 8, mantissaBits: 23, bias: 127 },
  f64: { id: 'f64', label: 'float64', bits: 64, exponentBits: 11, mantissaBits: 52, bias: 1023 },
};

const layout = (kind) => {
  const spec = FLOATS[kind];
  if (!spec) throw new Error(`Unknown float kind "${kind}".`);
  return spec;
};

/**
 * Parses a decimal for the float panel: numbers, scientific notation, NaN, Infinity/inf with signs,
 * and -0. Returns a JS number. Throws for anything else.
 */
export function parseFloatInput(input) {
  const text = String(input ?? '').trim().replace(/[_\s]/g, '').toLowerCase();
  if (!text) throw new Error('Enter a number, like 0.1, -2.5e-3, NaN or -Infinity.');
  if (text === 'nan' || text === '+nan' || text === '-nan') return NaN;
  const inf = /^([+-]?)(inf|infinity|∞)$/.exec(text);
  if (inf) return inf[1] === '-' ? -Infinity : Infinity;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(text)) throw new Error(`"${String(input).trim()}" isn't a decimal number.`);
  return Number(text);
}

/**
 * Writes a decimal like "1.50e-3" in the same canonical form exactDecimal uses ("0.0015"), so the two
 * can be compared exactly. Returns null for NaN, infinities, invalid text or absurd exponents.
 */
export function normalizeDecimal(input) {
  const match = /^([+-]?)(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i.exec(String(input ?? '').trim().replace(/[_\s]/g, ''));
  if (!match || !(match[2] || match[3])) return null;
  const [, sign, whole, fraction, expText] = match;
  const exp = Number(expText || 0);
  if (Math.abs(exp) > 5000) return null;
  const all = whole + fraction;
  // Where the decimal point falls within `all`.
  const point = whole.length + exp;
  let intPart;
  let fracPart;
  if (point <= 0) {
    intPart = '0';
    fracPart = '0'.repeat(-point) + all;
  } else if (point >= all.length) {
    intPart = all + '0'.repeat(point - all.length);
    fracPart = '';
  } else {
    intPart = all.slice(0, point);
    fracPart = all.slice(point);
  }
  intPart = intPart.replace(/^0+(?=\d)/, '');
  fracPart = fracPart.replace(/0+$/, '');
  return (sign === '-' ? '-' : '') + intPart + (fracPart ? `.${fracPart}` : '');
}

/** True when the decimal the person typed is exactly the value stored (exactDecimal output). */
export function isExactlyStored(input, exact) {
  const normal = normalizeDecimal(input);
  if (normal === null) return true;
  const strip = (text) => text.replace(/^-(?=0$)/, '');
  return strip(normal) === strip(exact);
}

/** The raw bits of a number stored as float32 or float64, as an unsigned BigInt. */
export function floatToBits(value, kind) {
  const view = new DataView(new ArrayBuffer(8));
  if (kind === 'f32') {
    view.setFloat32(0, value);
    return BigInt(view.getUint32(0));
  }
  layout(kind);
  view.setFloat64(0, value);
  return view.getBigUint64(0);
}

/** The number stored by a bit pattern (float32 values come back as the equivalent float64). */
export function bitsToFloat(bits, kind) {
  const view = new DataView(new ArrayBuffer(8));
  if (kind === 'f32') {
    view.setUint32(0, Number(BigInt.asUintN(32, bits)));
    return view.getFloat32(0);
  }
  layout(kind);
  view.setBigUint64(0, BigInt.asUintN(64, bits));
  return view.getFloat64(0);
}

/**
 * Parses hex bits for a float, e.g. "3dcccccd" or "0x3FB999999999999A". Spaces and underscores are ignored.
 * Must not have more hex digits than the format holds. Returns the BigInt pattern.
 */
export function parseFloatHex(input, kind) {
  const spec = layout(kind);
  const text = String(input ?? '').trim().toLowerCase().replace(/^0x/, '').replace(/[\s_]/g, '');
  if (!text) throw new Error('Enter hex digits, like 3dcccccd.');
  if (!/^[0-9a-f]+$/.test(text)) throw new Error('Only hex digits 0-9 and a-f are allowed.');
  if (text.length > spec.bits / 4) throw new Error(`A ${spec.label} has ${spec.bits / 4} hex digits; this has ${text.length}.`);
  return BigInt(`0x${text}`);
}

/**
 * The exact decimal value a finite float bit pattern stores, with every digit, e.g. float64 0.1 →
 * "0.1000000000000000055511151231257827021181583404541015625". Returns "NaN", "Infinity" or "-Infinity"
 * for those, and "-0" for negative zero.
 */
export function exactDecimal(bits, kind) {
  const { sign, exponent, mantissa, kind: cls } = decodeFloat(bits, kind);
  const minus = sign ? '-' : '';
  if (cls === 'nan') return 'NaN';
  if (cls === 'infinity') return `${minus}Infinity`;
  if (cls === 'zero') return `${minus}0`;
  const spec = layout(kind);
  // value = significand × 2^power, with the significand as an integer.
  const significand = cls === 'subnormal' ? mantissa : mantissa | (1n << BigInt(spec.mantissaBits));
  const power = (cls === 'subnormal' ? 1 - spec.bias : exponent - spec.bias) - spec.mantissaBits;
  if (power >= 0) return minus + (significand << BigInt(power)).toString();
  // significand / 2^k = significand × 5^k / 10^k
  const k = -power;
  const digits = (significand * 5n ** BigInt(k)).toString().padStart(k + 1, '0');
  const whole = digits.slice(0, digits.length - k);
  const fraction = digits.slice(digits.length - k).replace(/0+$/, '');
  return minus + whole + (fraction ? `.${fraction}` : '');
}

/**
 * Splits a float bit pattern into fields. Returns { sign, exponent, mantissa, kind, unbiased, quiet }:
 * exponent is the raw biased field, kind is 'zero' | 'subnormal' | 'normal' | 'infinity' | 'nan',
 * unbiased is the effective power of two (null for zero, infinity and NaN), quiet is set for NaN.
 */
export function decodeFloat(bits, kind) {
  const spec = layout(kind);
  const mantissaMask = (1n << BigInt(spec.mantissaBits)) - 1n;
  const exponentMax = (1 << spec.exponentBits) - 1;
  const pattern = BigInt.asUintN(spec.bits, bits);
  const mantissa = pattern & mantissaMask;
  const exponent = Number((pattern >> BigInt(spec.mantissaBits)) & BigInt(exponentMax));
  const sign = Number(pattern >> BigInt(spec.bits - 1));
  let cls;
  if (exponent === 0) cls = mantissa === 0n ? 'zero' : 'subnormal';
  else if (exponent === exponentMax) cls = mantissa === 0n ? 'infinity' : 'nan';
  else cls = 'normal';
  return {
    sign,
    exponent,
    mantissa,
    kind: cls,
    unbiased: cls === 'normal' ? exponent - spec.bias : cls === 'subnormal' ? 1 - spec.bias : null,
    quiet: cls === 'nan' ? Boolean(mantissa >> BigInt(spec.mantissaBits - 1)) : null,
  };
}

/** Bits of a pattern as a string of 0/1 of the given length. */
const bitString = (value, length) => value.toString(2).padStart(length, '0');

/** Formats a number the way JS prints it, keeping "-0". */
export const showNumber = (n) => (Object.is(n, -0) ? '-0' : String(n));

/**
 * Everything the float panel shows for a value stored as float32 or float64:
 * { bits, hex, signBits, exponentBits, mantissaBits, fields, stored, storedText, exact, rounded }.
 * storedText is the shortest decimal that round-trips; rounded is true when the input wasn't exactly representable.
 */
export function describeFloat(value, kind) {
  const bits = floatToBits(value, kind);
  return describeFloatBits(bits, kind, value);
}

/** Like describeFloat, starting from a bit pattern. `input` (optional) is the number that was asked for. */
export function describeFloatBits(bits, kind, input = undefined) {
  const spec = layout(kind);
  const fields = decodeFloat(bits, kind);
  const stored = bitsToFloat(bits, kind);
  const exact = exactDecimal(bits, kind);
  const storedText = kind === 'f32' ? shortestFloat32(stored) : showNumber(stored);
  return {
    bits,
    hex: bits.toString(16).padStart(spec.bits / 4, '0'),
    signBits: String(fields.sign),
    exponentBits: bitString(BigInt(fields.exponent), spec.exponentBits),
    mantissaBits: bitString(fields.mantissa, spec.mantissaBits),
    fields,
    stored,
    storedText,
    exact,
    rounded: input !== undefined && !Number.isNaN(input) && input !== stored,
  };
}

/** The shortest decimal string that reads back as the same float32 (like Rust/Java float printing). */
export function shortestFloat32(value) {
  if (!Number.isFinite(value) || value === 0) return showNumber(value);
  for (let digits = 1; digits <= 9; digits++) {
    const text = value.toPrecision(digits);
    if (Math.fround(Number(text)) === value) return String(Number(text));
  }
  return String(value);
}

/** A plain-language label for the float class. */
export function floatClassLabel(fields) {
  switch (fields.kind) {
    case 'zero':
      return fields.sign ? 'Negative zero' : 'Zero';
    case 'subnormal':
      return 'Subnormal';
    case 'normal':
      return 'Normal';
    case 'infinity':
      return fields.sign ? '−Infinity' : '+Infinity';
    default:
      return fields.quiet ? 'NaN (quiet)' : 'NaN (signaling)';
  }
}
