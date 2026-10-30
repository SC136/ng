// Password and PIN generation. No DOM access, so Node tests can import it.
// Every function that needs randomness takes an `rng` shaped like crypto.getRandomValues,
// so tests can pass a deterministic one.

export const LOWER = 'abcdefghijklmnopqrstuvwxyz';
export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const DIGITS = '0123456789';
export const DEFAULT_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?/~';
// Characters that are easy to confuse with each other in common fonts.
export const AMBIGUOUS = 'Il1|O0o`\'"';

export const MIN_LENGTH = 4;
export const MAX_LENGTH = 128;
export const MAX_COUNT = 50;
// Offline attack against a fast hash on a GPU rig.
export const GUESSES_PER_SECOND = 1e10;

/** The default random source: the platform's CSPRNG. */
export const cryptoRng = (array) => crypto.getRandomValues(array);

const TWO_32 = 2 ** 32;

/**
 * Returns a uniform integer in [0, max) using rejection sampling, so there is no modulo bias.
 * `rng` fills a Uint32Array like crypto.getRandomValues.
 */
export function randomInt(max, rng = cryptoRng) {
  if (!Number.isInteger(max) || max < 1 || max > TWO_32) throw new Error('randomInt needs a whole number from 1 to 2^32.');
  if (max === 1) return 0;
  // The largest multiple of max that fits in 32 bits; values at or above it are thrown away.
  const limit = TWO_32 - (TWO_32 % max);
  const buffer = new Uint32Array(1);
  for (;;) {
    rng(buffer);
    if (buffer[0] < limit) return buffer[0] % max;
  }
}

/** Shuffles an array in place with Fisher–Yates, using the same unbiased source. Returns it. */
export function shuffle(list, rng = cryptoRng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rng);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Builds the character pools for the chosen options. Pools never share a character
 * (a symbol set that repeats a letter keeps it only in the letter pool), excluded characters
 * are removed, and empty pools are dropped. Returns [{ name, chars: string[] }].
 */
export function buildPools({
  lower = true, upper = true, digits = true, symbols = true, symbolSet = DEFAULT_SYMBOLS,
  excludeAmbiguous = false, exclude = '',
} = {}) {
  const banned = new Set([...String(exclude)]);
  if (excludeAmbiguous) for (const ch of AMBIGUOUS) banned.add(ch);
  const seen = new Set();
  const pools = [];
  const add = (name, text) => {
    const chars = [];
    for (const ch of text) {
      // Whitespace in a password is a trap: hard to see, often trimmed by forms.
      if (/\s/u.test(ch) || banned.has(ch) || seen.has(ch)) continue;
      seen.add(ch);
      chars.push(ch);
    }
    if (chars.length) pools.push({ name, chars });
  };
  if (lower) add('lowercase', LOWER);
  if (upper) add('uppercase', UPPER);
  if (digits) add('digits', DIGITS);
  if (symbols) add('symbols', String(symbolSet));
  return pools;
}

function checkLength(length) {
  if (!Number.isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) {
    throw new Error(`Length must be a whole number from ${MIN_LENGTH} to ${MAX_LENGTH}.`);
  }
}

/**
 * Generates one password. Options are those of buildPools plus length and requireEach
 * (at least one character from every chosen set). Throws an Error with a plain message
 * when the options can't produce a password.
 */
export function generatePassword(options = {}, rng = cryptoRng) {
  const { length = 20, requireEach = true } = options;
  checkLength(length);
  const pools = buildPools(options);
  if (!pools.length) throw new Error('Pick at least one character set that still has characters after exclusions.');
  if (requireEach && pools.length > length) {
    throw new Error(`A ${length}-character password can't include one from each of ${pools.length} sets.`);
  }
  const all = pools.flatMap((pool) => pool.chars);
  const out = [];
  if (requireEach) for (const pool of pools) out.push(pool.chars[randomInt(pool.chars.length, rng)]);
  while (out.length < length) out.push(all[randomInt(all.length, rng)]);
  return shuffle(out, rng).join('');
}

/** Generates a numeric PIN of the given length. */
export function generatePin(length = 6, rng = cryptoRng) {
  checkLength(length);
  let out = '';
  for (let i = 0; i < length; i++) out += DIGITS[randomInt(10, rng)];
  return out;
}

/** Generates `count` passwords or PINs. mode: 'password' | 'pin'. */
export function generateMany(mode, options, count = 1, rng = cryptoRng) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw new Error(`Count must be from 1 to ${MAX_COUNT}.`);
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push(mode === 'pin' ? generatePin(options.length, rng) : generatePassword(options, rng));
  }
  return list;
}

/** log2 of a positive BigInt, accurate to double precision. */
export function log2BigInt(value) {
  if (value <= 0n) return -Infinity;
  const bits = value.toString(2).length;
  if (bits <= 53) return Math.log2(Number(value));
  const shift = BigInt(bits - 53);
  return Math.log2(Number(value >> shift)) + Number(shift);
}

/**
 * Exact number of possible outputs for these pool sizes and length. With requireEach it counts
 * only strings that use every pool (inclusion–exclusion over the disjoint pools).
 */
export function countPossible(poolSizes, length, requireEach) {
  const total = poolSizes.reduce((sum, size) => sum + size, 0);
  if (!requireEach) return BigInt(total) ** BigInt(length);
  let count = 0n;
  const n = poolSizes.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    let left = total;
    let bits = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        left -= poolSizes[i];
        bits++;
      }
    }
    const term = BigInt(left) ** BigInt(length);
    count += bits % 2 ? -term : term;
  }
  return count;
}

/** Entropy in bits of one generated password/PIN for these options. */
export function entropyBits(mode, options = {}) {
  const length = options.length ?? 20;
  if (mode === 'pin') return length * Math.log2(10);
  const pools = buildPools(options);
  if (!pools.length) return 0;
  return log2BigInt(countPossible(pools.map((pool) => pool.chars.length), length, options.requireEach ?? true));
}

/** A plain-language label for an entropy in bits: { label, tone } with tone 'err' | 'warn' | 'ok'. */
export function strengthLabel(bits) {
  if (bits < 28) return { label: 'Very weak', tone: 'err' };
  if (bits < 40) return { label: 'Weak', tone: 'err' };
  if (bits < 60) return { label: 'Fair', tone: 'warn' };
  if (bits < 80) return { label: 'Strong', tone: 'ok' };
  return { label: 'Very strong', tone: 'ok' };
}

/** Average seconds to find a secret with `bits` of entropy (half the space) at `rate` guesses per second. */
export function crackSeconds(bits, rate = GUESSES_PER_SECOND) {
  return 2 ** (bits - 1) / rate;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const YEAR = 365.25 * DAY;

/** Formats a duration in seconds as short plain English, e.g. "3 hours", "about 10^24 years". */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'longer than the universe will exist';
  if (seconds < 1) return 'less than a second';
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (seconds < MINUTE) return plural(Math.round(seconds), 'second');
  if (seconds < HOUR) return plural(Math.round(seconds / MINUTE), 'minute');
  if (seconds < DAY) return plural(Math.round(seconds / HOUR), 'hour');
  if (seconds < YEAR) return plural(Math.round(seconds / DAY), 'day');
  const years = seconds / YEAR;
  if (years < 1000) return plural(Math.round(years), 'year');
  if (years < 1e6) return `${Math.round(years / 1000)} thousand years`;
  if (years < 1e9) return `${Math.round(years / 1e6)} million years`;
  if (years < 1e12) return `${Math.round(years / 1e9)} billion years`;
  return `about 10^${Math.floor(Math.log10(years))} years`;
}
