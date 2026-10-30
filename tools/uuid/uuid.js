// UUID, ULID and nanoid generation and inspection. No DOM access, so Node tests can import it.

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const MAX_COUNT = 1000;

/** nanoid alphabet presets. */
export const ALPHABETS = {
  urlsafe: { label: 'URL-safe (A–Z a–z 0–9 _ -)', chars: 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict' },
  alphanumeric: { label: 'Letters and digits', chars: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' },
  lowercase: { label: 'Lower case and digits', chars: '0123456789abcdefghijklmnopqrstuvwxyz' },
  hex: { label: 'Hex (0–9 a–f)', chars: '0123456789abcdef' },
  numbers: { label: 'Digits only', chars: '0123456789' },
  nolookalikes: { label: 'No look-alikes (no 1 l I 0 O o …)', chars: '346789ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnpqrtwxyz' },
};

const randomBytes = (count, random = crypto) => random.getRandomValues(new Uint8Array(count));

/** Formats 16 bytes as a UUID. hyphens: false gives 32 bare hex digits. */
export function formatUuid(bytes, { uppercase = false, hyphens = true } = {}) {
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (hyphens && (i === 4 || i === 6 || i === 8 || i === 10)) out += '-';
    out += HEX[bytes[i]];
  }
  return uppercase ? out.toUpperCase() : out;
}

/** A random (version 4) UUID as 16 bytes. */
export function uuidV4Bytes(random = crypto) {
  const bytes = randomBytes(16, random);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes;
}

const bigFromBytes = (bytes) => bytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);

/**
 * Returns a UUID v7 generator (RFC 9562): 48-bit Unix milliseconds, then 74 random bits.
 * Within one millisecond the 74 bits count up by one (RFC 9562 §6.2 method 2), so IDs from
 * one generator always sort in the order they were made. If the clock goes backwards the last
 * timestamp is reused. Each call returns 16 bytes.
 */
export function createUuidV7({ now = Date.now, random = crypto } = {}) {
  let lastTime = -1;
  let counter = 0n;
  const MAX = (1n << 74n) - 1n;
  return () => {
    let time = Math.max(Math.floor(now()), lastTime);
    if (time === lastTime) {
      counter++;
      if (counter > MAX) {
        // Out of room in this millisecond: borrow the next one.
        time++;
        counter = bigFromBytes(randomBytes(10, random)) & MAX;
      }
    } else counter = bigFromBytes(randomBytes(10, random)) & MAX;
    lastTime = time;
    const bytes = new Uint8Array(16);
    let t = time;
    for (let i = 5; i >= 0; i--) {
      bytes[i] = t % 256;
      t = Math.floor(t / 256);
    }
    const randA = Number(counter >> 62n);
    const randB = counter & ((1n << 62n) - 1n);
    bytes[6] = 0x70 | (randA >> 8);
    bytes[7] = randA & 0xff;
    for (let i = 15; i >= 9; i--) bytes[i] = Number((randB >> BigInt((15 - i) * 8)) & 0xffn);
    bytes[8] = 0x80 | Number(randB >> 56n);
    return bytes;
  };
}

/** Encodes a millisecond time as the 10-character ULID time part. */
export function encodeUlidTime(time) {
  if (!Number.isInteger(time) || time < 0 || time > 2 ** 48 - 1) throw new Error('ULID time must be a whole number of milliseconds from 0 to 2^48 − 1.');
  let out = '';
  let t = time;
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

/**
 * Returns a ULID generator. Within one millisecond the 80-bit random part counts up by one,
 * as the ULID spec's monotonic mode does, so IDs from one generator sort in creation order.
 */
export function createUlid({ now = Date.now, random = crypto } = {}) {
  let lastTime = -1;
  let rand = 0n;
  const MAX = (1n << 80n) - 1n;
  return () => {
    let time = Math.max(Math.floor(now()), lastTime);
    if (time === lastTime) {
      rand++;
      if (rand > MAX) {
        time++;
        rand = bigFromBytes(randomBytes(10, random));
      }
    } else rand = bigFromBytes(randomBytes(10, random));
    lastTime = time;
    let tail = '';
    let r = rand;
    for (let i = 0; i < 16; i++) {
      tail = CROCKFORD[Number(r & 31n)] + tail;
      r >>= 5n;
    }
    return encodeUlidTime(time) + tail;
  };
}

/**
 * Decodes a ULID. Accepts lower case and Crockford's look-alikes (I and L read as 1, O as 0).
 * Returns { time, random } (random as 20 hex digits). Throws for anything that isn't a ULID.
 */
export function decodeUlid(text) {
  const clean = String(text).trim().toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0');
  if (clean.length !== 26) throw new Error(`A ULID has 26 characters; this has ${clean.length}.`);
  const bad = [...clean].find((ch) => !CROCKFORD.includes(ch));
  if (bad) throw new Error(`"${bad}" isn't a ULID character.`);
  if (clean[0] > '7') throw new Error('This ULID is too large: the first character must be 0–7.');
  let time = 0;
  for (const ch of clean.slice(0, 10)) time = time * 32 + CROCKFORD.indexOf(ch);
  let rand = 0n;
  for (const ch of clean.slice(10)) rand = (rand << 5n) | BigInt(CROCKFORD.indexOf(ch));
  return { time, random: rand.toString(16).padStart(20, '0'), canonical: clean };
}

/** Checks a custom nanoid alphabet: 2 to 256 different characters. Returns its characters. */
export function checkAlphabet(alphabet) {
  const chars = Array.from(String(alphabet));
  if (chars.length < 2) throw new Error('The alphabet needs at least 2 characters.');
  if (chars.length > 256) throw new Error('The alphabet can have at most 256 characters.');
  const repeated = chars.find((ch, i) => chars.indexOf(ch) !== i);
  if (repeated) throw new Error(`"${repeated}" appears more than once in the alphabet.`);
  return chars;
}

/**
 * A nanoid of `size` characters from `alphabet`. Uses a bit mask and rejects out-of-range
 * values instead of taking a modulo, so every character is equally likely.
 */
export function nanoid(size = 21, alphabet = ALPHABETS.urlsafe.chars, random = crypto) {
  const chars = checkAlphabet(alphabet);
  if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error('Size must be a whole number from 1 to 256.');
  const mask = (2 << (31 - Math.clz32((chars.length - 1) | 1))) - 1;
  // Enough bytes for one pass most of the time, given the rejection rate.
  const step = Math.ceil((1.6 * mask * size) / chars.length);
  let id = '';
  let count = 0;
  while (true) {
    const bytes = randomBytes(step, random);
    for (let i = 0; i < step; i++) {
      const index = bytes[i] & mask;
      if (index < chars.length) {
        id += chars[index];
        if (++count === size) return id;
      }
    }
  }
}

/**
 * Generates a batch. options: type ('v4' | 'v7' | 'ulid' | 'nanoid'), count (1–1000),
 * uppercase, hyphens (UUIDs only), size and alphabet (nanoid only).
 * deps: { now, random } for tests.
 */
export function generate({ type = 'v4', count = 1, uppercase = false, hyphens = true, size = 21, alphabet = ALPHABETS.urlsafe.chars } = {}, deps = {}) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw new Error(`Count must be a whole number from 1 to ${MAX_COUNT}.`);
  const random = deps.random ?? crypto;
  const format = { uppercase, hyphens };
  if (type === 'v4') return Array.from({ length: count }, () => formatUuid(uuidV4Bytes(random), format));
  if (type === 'v7') {
    const next = createUuidV7(deps);
    return Array.from({ length: count }, () => formatUuid(next(), format));
  }
  if (type === 'ulid') {
    const next = createUlid(deps);
    return Array.from({ length: count }, () => next());
  }
  if (type === 'nanoid') {
    checkAlphabet(alphabet);
    return Array.from({ length: count }, () => nanoid(size, alphabet, random));
  }
  throw new Error(`Unknown ID type "${type}".`);
}

const VERSIONS = {
  1: 'Version 1 (time and node)',
  2: 'Version 2 (DCE security)',
  3: 'Version 3 (MD5 name-based)',
  4: 'Version 4 (random)',
  5: 'Version 5 (SHA-1 name-based)',
  6: 'Version 6 (reordered time)',
  7: 'Version 7 (Unix time and random)',
  8: 'Version 8 (custom)',
};

// 100-nanosecond intervals between the Gregorian calendar reform (1582-10-15) and 1970-01-01.
const GREGORIAN_OFFSET = 0x01b21dd213814000n;

/** Parses a UUID in hyphenated, bare, {braced} or urn:uuid: form into 16 bytes, or null. */
export function parseUuid(text) {
  const clean = String(text).trim().replace(/^urn:uuid:/i, '').replace(/^\{([^}]*)\}$/, '$1');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean) && !/^[0-9a-f]{32}$/i.test(clean)) return null;
  const hex = clean.replace(/-/g, '');
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

function variantOf(byte) {
  if ((byte & 0x80) === 0) return 'NCS (reserved, old Apollo)';
  if ((byte & 0xc0) === 0x80) return 'RFC 9562';
  if ((byte & 0xe0) === 0xc0) return 'Microsoft (reserved)';
  return 'Reserved for the future';
}

/**
 * Inspects a UUID or ULID. Returns { valid, kind, canonical, version, versionLabel, variant,
 * time (ms since 1970 or null), nil, max, notes } or { valid: false, error }.
 */
export function inspect(text) {
  const input = String(text).trim();
  if (!input) return { valid: false, error: 'Paste an ID to inspect it.' };
  const bytes = parseUuid(input);
  if (bytes) {
    const canonical = formatUuid(bytes);
    const nil = bytes.every((byte) => byte === 0);
    const max = bytes.every((byte) => byte === 0xff);
    const result = { valid: true, kind: 'uuid', canonical, nil, max, version: null, versionLabel: '', variant: '', time: null, notes: [] };
    if (nil || max) {
      result.versionLabel = nil ? 'Nil UUID (all zeros)' : 'Max UUID (all ones)';
      result.variant = 'None (special value)';
      return result;
    }
    result.variant = variantOf(bytes[8]);
    if (result.variant !== 'RFC 9562') {
      result.notes.push('The variant bits are not the RFC 9562 ones, so the version number has no standard meaning.');
      return result;
    }
    const version = bytes[6] >> 4;
    result.version = version;
    result.versionLabel = VERSIONS[version] || `Version ${version} (not defined)`;
    if (version === 7) {
      result.time = bytes.slice(0, 6).reduce((acc, byte) => acc * 256 + byte, 0);
    } else if (version === 1 || version === 6) {
      const b = (i) => BigInt(bytes[i]);
      const ticks = version === 1
        ? ((((b(6) & 0x0fn) << 8n) | b(7)) << 48n) | (((b(4) << 8n) | b(5)) << 32n) | (b(0) << 24n) | (b(1) << 16n) | (b(2) << 8n) | b(3)
        : (bigFromBytes(bytes.slice(0, 6)) << 12n) | ((b(6) & 0x0fn) << 8n) | b(7);
      result.time = Number((ticks - GREGORIAN_OFFSET) / 10000n);
      result.node = Array.from(bytes.slice(10), (byte) => HEX[byte]).join(':');
      result.clockSeq = ((bytes[8] & 0x3f) << 8) | bytes[9];
    }
    return result;
  }
  if (/^[0-9a-z]{26}$/i.test(input)) {
    try {
      const { time, canonical } = decodeUlid(input);
      return { valid: true, kind: 'ulid', canonical, nil: /^0+$/.test(canonical), max: canonical === '7ZZZZZZZZZZZZZZZZZZZZZZZZZ', version: null, versionLabel: 'ULID', variant: '', time, notes: [] };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
  const compact = input.replace(/[-{}\s]/g, '');
  if (/^[0-9a-f]+$/i.test(compact)) return { valid: false, error: `A UUID has 32 hex digits; this has ${compact.length}.` };
  if (/[^0-9a-f-]/i.test(input) && input.replace(/-/g, '').length === 32) return { valid: false, error: 'A UUID only uses 0–9 and a–f.' };
  return { valid: false, error: "This isn't a UUID or a ULID. Nanoids have no structure to inspect." };
}

/** Bits of entropy in one nanoid: size × log2(alphabet length). */
export const nanoidBits = (size, alphabetLength) => size * Math.log2(alphabetLength);
