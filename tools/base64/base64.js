// Base64 logic. No DOM access, so Node tests can import it.

const encoder = new TextEncoder();
// fatal: invalid UTF-8 throws instead of becoming U+FFFD. ignoreBOM: keep a leading BOM as text.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export const utf8Bytes = (text) => encoder.encode(text);

/** Encodes bytes as Base64. urlSafe swaps "+/" for "-_"; pad: false drops the trailing "=". */
export function bytesToBase64(bytes, { urlSafe = false, pad = true } = {}) {
  let binary = '';
  // Chunked so huge inputs don't exceed the engine's argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  let out = btoa(binary);
  if (urlSafe) out = out.replace(/\+/g, '-').replace(/\//g, '_');
  if (!pad) out = out.replace(/=+$/, '');
  return out;
}

export const encodeText = (text, options) => bytesToBase64(utf8Bytes(text), options);

/**
 * Decodes standard or URL-safe Base64 (both alphabets may be mixed). Whitespace and missing
 * padding are fine. Anything else throws an Error that says what is wrong and where.
 */
export function base64ToBytes(input) {
  const text = String(input);
  const badAt = text.search(/[^A-Za-z0-9+/\-_=\s]/);
  if (badAt !== -1) {
    const ch = String.fromCodePoint(text.codePointAt(badAt));
    throw new Error(`"${ch}" at position ${badAt + 1} isn't a Base64 character.`);
  }
  const compact = text.replace(/\s+/g, '');
  const firstPad = compact.indexOf('=');
  if (firstPad !== -1 && /[^=]/.test(compact.slice(firstPad))) {
    throw new Error('"=" padding can only appear at the end.');
  }
  const body = compact.slice(0, firstPad === -1 ? compact.length : firstPad).replace(/-/g, '+').replace(/_/g, '/');
  const padding = compact.length - body.length;
  if (body.length % 4 === 1) {
    throw new Error(`${body.length} characters can't be valid Base64. One is probably missing or extra.`);
  }
  if (padding && (padding > 2 || (body.length + padding) % 4 !== 0)) {
    throw new Error('Wrong amount of "=" padding at the end.');
  }
  const binary = atob(body + '='.repeat((4 - (body.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Returns the bytes as text if they are valid UTF-8 without control characters
 * (tab, newline and carriage return are allowed), otherwise null.
 */
export function bytesToText(bytes) {
  let text;
  try {
    text = strictUtf8.decode(bytes);
  } catch {
    return null;
  }
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text) ? null : text;
}

/** Parses "data:[mime][;params][;base64],payload". Returns null when the text isn't a data URL. */
export function parseDataUrl(text) {
  const match = /^data:([^,]*),(.*)$/s.exec(String(text).trim());
  if (!match) return null;
  const params = match[1].split(';');
  const base64 = params.length > 1 && params[params.length - 1].toLowerCase() === 'base64';
  return { mime: params[0].trim() || 'text/plain', base64, payload: match[2] };
}

export const toDataUrl = (bytes, mime = 'application/octet-stream') => `data:${mime};base64,${bytesToBase64(bytes)}`;

/**
 * Decodes Base64 or a data URL. Returns { bytes, text, mime }: text is null for binary data,
 * mime is set only for data URLs.
 */
export function decodeBase64Text(input) {
  const dataUrl = parseDataUrl(input);
  let bytes;
  if (dataUrl && !dataUrl.base64) {
    try {
      bytes = utf8Bytes(decodeURIComponent(dataUrl.payload));
    } catch {
      throw new Error('This data URL has broken percent-encoding.');
    }
  } else {
    bytes = base64ToBytes(dataUrl ? dataUrl.payload : input);
  }
  return { bytes, text: bytesToText(bytes), mime: dataUrl ? dataUrl.mime : null };
}

const SIGNATURES = [
  { mime: 'image/png', ext: 'png', label: 'PNG image', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG image', magic: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', ext: 'gif', label: 'GIF image', magic: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', ext: 'webp', label: 'WebP image', magic: [0x52, 0x49, 0x46, 0x46], also: [8, [0x57, 0x45, 0x42, 0x50]] },
  { mime: 'application/pdf', ext: 'pdf', label: 'PDF document', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { mime: 'application/zip', ext: 'zip', label: 'ZIP archive', magic: [0x50, 0x4b, 0x03, 0x04] },
  { mime: 'application/gzip', ext: 'gz', label: 'gzip archive', magic: [0x1f, 0x8b] },
  { mime: 'application/wasm', ext: 'wasm', label: 'WebAssembly module', magic: [0x00, 0x61, 0x73, 0x6d] },
  { mime: 'audio/mpeg', ext: 'mp3', label: 'MP3 audio', magic: [0x49, 0x44, 0x33] },
  { mime: 'audio/ogg', ext: 'ogg', label: 'Ogg audio', magic: [0x4f, 0x67, 0x67, 0x53] },
  { mime: 'image/x-icon', ext: 'ico', label: 'icon', magic: [0x00, 0x00, 0x01, 0x00] },
  { mime: 'video/mp4', ext: 'mp4', label: 'MP4 video', offset: 4, magic: [0x66, 0x74, 0x79, 0x70] },
];

/** Guesses a file type from its first bytes. Unknown data is application/octet-stream (.bin). */
export function guessMime(bytes) {
  const has = (offset, magic) => magic.every((byte, i) => bytes[offset + i] === byte);
  for (const sig of SIGNATURES) {
    if (has(sig.offset ?? 0, sig.magic) && (!sig.also || has(...sig.also))) {
      return { mime: sig.mime, ext: sig.ext, label: sig.label };
    }
  }
  return { mime: 'application/octet-stream', ext: 'bin', label: '' };
}

/** The first `count` bytes as spaced hex, e.g. "89 50 4e 47 …". */
export function hexPreview(bytes, count = 16) {
  const shown = Array.from(bytes.subarray(0, count), (byte) => byte.toString(16).padStart(2, '0')).join(' ');
  return bytes.length > count ? `${shown} …` : shown;
}
