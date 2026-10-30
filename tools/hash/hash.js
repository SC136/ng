// Hash logic: MD5 and CRC32 written here (Web Crypto has neither), SHA via crypto.subtle,
// HMAC for all of them except CRC32, output formatting and comparing. No DOM access.

// ---------- MD5 (RFC 1321) ----------
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0;
const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

/** Incremental MD5: new Md5().update(bytes).update(more).digest() → 16 bytes. */
export class Md5 {
  constructor() {
    this.state = Int32Array.of(0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476);
    this.buffer = new Uint8Array(64);
    this.buffered = 0;
    this.length = 0;
    this.words = new Int32Array(16);
  }

  update(bytes) {
    let i = 0;
    this.length += bytes.length;
    if (this.buffered) {
      const take = Math.min(64 - this.buffered, bytes.length);
      this.buffer.set(bytes.subarray(0, take), this.buffered);
      this.buffered += take;
      i = take;
      if (this.buffered < 64) return this;
      this.block(this.buffer, 0);
      this.buffered = 0;
    }
    for (; i + 64 <= bytes.length; i += 64) this.block(bytes, i);
    if (i < bytes.length) {
      this.buffer.set(bytes.subarray(i), 0);
      this.buffered = bytes.length - i;
    }
    return this;
  }

  block(x, o) {
    const w = this.words;
    for (let j = 0; j < 16; j++) {
      const p = o + j * 4;
      w[j] = x[p] | (x[p + 1] << 8) | (x[p + 2] << 16) | (x[p + 3] << 24);
    }
    const st = this.state;
    let a = st[0];
    let b = st[1];
    let c = st[2];
    let d = st[3];
    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      const s = S[((i >> 4) << 2) | (i & 3)];
      const sum = (a + f + K[i] + w[g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << s) | (sum >>> (32 - s)))) | 0;
    }
    st[0] = (st[0] + a) | 0;
    st[1] = (st[1] + b) | 0;
    st[2] = (st[2] + c) | 0;
    st[3] = (st[3] + d) | 0;
  }

  digest() {
    const bits = this.length * 8;
    const padLength = this.buffered < 56 ? 56 - this.buffered : 120 - this.buffered;
    const tail = new Uint8Array(padLength + 8);
    tail[0] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(padLength, bits % 2 ** 32, true);
    view.setUint32(padLength + 4, Math.floor(bits / 2 ** 32), true);
    this.update(tail);
    const out = new Uint8Array(16);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < 4; i++) outView.setInt32(i * 4, this.state[i], true);
    return out;
  }
}

/** MD5 of bytes, 16 bytes out. */
export const md5 = (bytes) => new Md5().update(bytes).digest();

// ---------- CRC32 (IEEE 802.3, as in zip and PNG) ----------
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

/** Incremental CRC32: new Crc32().update(bytes).digest() → 4 bytes, big-endian. */
export class Crc32 {
  constructor() {
    this.crc = -1;
  }

  update(bytes) {
    let crc = this.crc;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    this.crc = crc;
    return this;
  }

  value() {
    return (this.crc ^ -1) >>> 0;
  }

  digest() {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, this.value());
    return out;
  }
}

/** CRC32 of bytes as an unsigned number. */
export const crc32 = (bytes) => new Crc32().update(bytes).value();

// ---------- HMAC ----------
/** HMAC-MD5 (RFC 2104) built on the MD5 above. */
export function hmacMd5(key, data) {
  const block = new Uint8Array(64);
  block.set(key.length > 64 ? md5(key) : key);
  const inner = new Uint8Array(64);
  const outer = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    inner[i] = block[i] ^ 0x36;
    outer[i] = block[i] ^ 0x5c;
  }
  const innerHash = new Md5().update(inner).update(data).digest();
  return new Md5().update(outer).update(innerHash).digest();
}

/** HMAC-SHA via Web Crypto. hash: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'. Key must not be empty. */
export async function hmacSha(hash, key, data) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data));
}

// ---------- All at once ----------
export const ALGORITHMS = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512', 'CRC32'];
const SHAS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
const CHUNK = 4 * 1024 * 1024;

/**
 * Hashes bytes with every algorithm. With a non-empty hmacKey (bytes) the MD5 and SHA results are
 * HMACs and CRC32 is left out. onProgress(fraction) reports progress through the MD5/CRC32 pass.
 * Resolves to [{ name, bytes }] in ALGORITHMS order, names prefixed "HMAC-" when keyed.
 */
export async function digestAll(bytes, { hmacKey = null, onProgress } = {}) {
  const keyed = hmacKey && hmacKey.length > 0;
  const results = [];
  if (keyed) {
    results.push({ name: 'HMAC-MD5', bytes: hmacMd5(hmacKey, bytes) });
    onProgress?.(1);
    for (const name of SHAS) results.push({ name: `HMAC-${name}`, bytes: await hmacSha(name, hmacKey, bytes) });
    return results;
  }
  const md = new Md5();
  const crc = new Crc32();
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    md.update(chunk);
    crc.update(chunk);
    onProgress?.(Math.min(1, (i + chunk.length) / bytes.length));
  }
  results.push({ name: 'MD5', bytes: md.digest() });
  for (const name of SHAS) results.push({ name, bytes: new Uint8Array(await crypto.subtle.digest(name, bytes)) });
  results.push({ name: 'CRC32', bytes: crc.digest() });
  return results;
}

// ---------- Formatting and comparing ----------
/** Formats digest bytes: 'hex' (lowercase), 'HEX' (uppercase) or 'base64'. */
export function formatDigest(bytes, format = 'hex') {
  if (format === 'base64') {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return format === 'HEX' ? hex.toUpperCase() : hex;
}

export const toHex = (bytes) => formatDigest(bytes, 'hex');

/** Parses a hex string (spaces and colons allowed) into bytes. Throws on odd length or bad characters. */
export function hexToBytes(text) {
  const clean = String(text).replace(/[\s:]/g, '').replace(/^0x/i, '');
  if (/[^0-9a-fA-F]/.test(clean)) throw new Error('The key has characters that aren\'t hex digits.');
  if (clean.length % 2) throw new Error('A hex key needs an even number of digits.');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Which results equal `expected`. Hex is compared ignoring case, spaces and colons;
 * Base64 is compared exactly (after trimming). Returns the matching names.
 */
export function findMatches(expected, results) {
  const trimmed = String(expected).trim();
  if (!trimmed) return [];
  const asHex = trimmed.replace(/[\s:]/g, '').toLowerCase();
  return results
    .filter(({ bytes }) => toHex(bytes) === asHex || formatDigest(bytes, 'base64') === trimmed)
    .map(({ name }) => name);
}
