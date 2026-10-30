// Image conversion logic: sizing, names, savings and a ZIP writer. No DOM access, so Node tests can import it.

/** Output formats in menu order. Which ones a browser can encode is probed in main.js. */
export const FORMATS = [
  { id: 'webp', mime: 'image/webp', ext: 'webp', label: 'WebP', lossy: true },
  { id: 'jpeg', mime: 'image/jpeg', ext: 'jpg', label: 'JPEG', lossy: true },
  { id: 'png', mime: 'image/png', ext: 'png', label: 'PNG', lossy: false },
  { id: 'avif', mime: 'image/avif', ext: 'avif', label: 'AVIF', lossy: true },
];

export const formatById = (id) => FORMATS.find((format) => format.id === id) || null;

/** Images above this many pixels are refused, to keep the tab from running out of memory. */
export const MAX_PIXELS = 100_000_000;
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

/**
 * Parses a max width/height field. Empty, zero or invalid means no limit (null).
 * Decimals round down; anything below 1 is no limit.
 */
export function parseLimit(text) {
  const value = Math.floor(Number(String(text ?? '').trim()));
  return Number.isFinite(value) && value >= 1 ? value : null;
}

/**
 * Scales width × height to fit inside maxWidth × maxHeight (either may be null for no limit),
 * keeping the aspect ratio and never upscaling. Returns { width, height, scaled }.
 */
export function fitSize(width, height, { maxWidth = null, maxHeight = null } = {}) {
  if (!(width > 0 && height > 0)) throw new Error('The image has no size.');
  const scale = Math.min(1, maxWidth ? maxWidth / width : 1, maxHeight ? maxHeight / height : 1);
  if (scale >= 1) return { width, height, scaled: false };
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  };
}

/**
 * The output file name: the original name with its extension swapped, e.g. "IMG_01.HEIC" → "IMG_01.webp".
 * Path separators and control characters are dropped; an empty name becomes "image".
 */
export function outputName(name, ext) {
  const base = String(name ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '');
  const stem = base.replace(/\.[^.]*$/, '').trim() || 'image';
  return `${stem}.${ext}`;
}

/** Makes names unique by adding " (2)", " (3)" … before the extension. Keeps order. */
export function uniqueNames(names) {
  const seen = new Set();
  return names.map((name) => {
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      return name;
    }
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = 2;
    while (seen.has(`${stem} (${n})${ext}`.toLowerCase())) n++;
    const unique = `${stem} (${n})${ext}`;
    seen.add(unique.toLowerCase());
    return unique;
  });
}

/**
 * Compares sizes. Returns { percent, smaller, text, tone }: percent is the saving (negative when the
 * output is larger), text reads like "38% smaller" or "12% larger", tone is 'ok' | 'warn' | ''.
 */
export function savings(before, after) {
  if (!(before > 0)) return { percent: 0, smaller: false, text: '', tone: '' };
  const percent = (1 - after / before) * 100;
  const rounded = Math.round(Math.abs(percent));
  if (after === before || rounded === 0) {
    return { percent, smaller: after < before, text: after < before ? 'Under 1% smaller' : after > before ? 'Under 1% larger' : 'Same size', tone: '' };
  }
  if (after < before) return { percent, smaller: true, text: `${rounded}% smaller`, tone: 'ok' };
  return { percent, smaller: false, text: `${rounded}% larger`, tone: 'warn' };
}

/** True when any pixel in RGBA data has alpha below 255. */
export function hasTransparency(rgba) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true;
  return false;
}

// ---------- ZIP (stored, no compression; images are already compressed) ----------

let crcTable;
/** CRC-32 (IEEE 802.3), as used by ZIP and PNG. */
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Builds an uncompressed ZIP archive from [{ name, bytes }] (bytes is a Uint8Array).
 * Names are stored as UTF-8. Returns a Uint8Array.
 */
export function makeZip(entries, date = new Date()) {
  const encoder = new TextEncoder();
  const stamp = dosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.bytes;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, stamp.time, true);
    central.setUint16(14, stamp.date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
