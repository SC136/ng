// URL logic: percent-encoding in three flavours, a decoder that reports where it fails,
// and helpers to take a URL apart and rebuild it from a list of query params. No DOM access.

/** A decoding error with a 1-based character position. */
export class UrlError extends Error {
  constructor(message, position) {
    super(message);
    this.name = 'UrlError';
    this.position = position;
  }
}

export const MODES = ['component', 'full', 'form'];

function findLoneSurrogate(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
      else return i;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return i;
    }
  }
  return -1;
}

const hex = (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;

/**
 * Percent-encodes text. mode: 'component' (encodeURIComponent), 'full' (encodeURI) or
 * 'form' (application/x-www-form-urlencoded: only A-Z a-z 0-9 * - . _ stay, space becomes +).
 */
export function encodeUrl(text, mode = 'component') {
  const str = String(text);
  const lone = findLoneSurrogate(str);
  if (lone !== -1) throw new UrlError(`Position ${lone + 1} holds half of a surrogate pair, which can't be encoded.`, lone + 1);
  if (mode === 'full') return encodeURI(str);
  if (mode === 'form') return encodeURIComponent(str).replace(/[!'()~]/g, hex).replace(/%20/g, '+');
  return encodeURIComponent(str);
}

// Characters decodeURI leaves encoded, because decoding them would change what the URL means.
const RESERVED = new Set(';/?:@&=+$,#');
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Decodes percent-encoding. 'form' also turns + into a space; 'full' keeps escapes of reserved
 * characters such as %2F, like decodeURI. Throws UrlError with the position of a malformed
 * % sequence or of bytes that aren't valid UTF-8.
 */
export function decodeUrl(text, mode = 'component') {
  const str = String(text);
  let out = '';
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '+' && mode === 'form') {
      out += ' ';
      i++;
      continue;
    }
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }
    // A run of %XX escapes is decoded together, since one character can span several bytes.
    const start = i;
    const bytes = [];
    const raws = [];
    while (str[i] === '%') {
      const pair = str.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(pair)) {
        const shown = str.slice(i, i + 3);
        throw new UrlError(`"${shown}" at position ${i + 1} isn't a valid escape. A % must be followed by two hex digits (use %25 for a literal %).`, i + 1);
      }
      bytes.push(parseInt(pair, 16));
      raws.push(str.slice(i, i + 3));
      i += 3;
    }
    out += decodeRun(bytes, raws, start, mode);
  }
  return out;
}

function decodeRun(bytes, raws, start, mode) {
  let out = '';
  let k = 0;
  while (k < bytes.length) {
    const b = bytes[k];
    const len = b < 0x80 ? 1 : b >= 0xc2 && b <= 0xdf ? 2 : b >= 0xe0 && b <= 0xef ? 3 : b >= 0xf0 && b <= 0xf4 ? 4 : 0;
    const chunk = bytes.slice(k, k + len);
    let ch = null;
    if (len && chunk.length === len) {
      try {
        ch = strictUtf8.decode(Uint8Array.from(chunk));
      } catch {}
    }
    if (ch === null) {
      const shown = raws.slice(k, k + Math.max(1, Math.min(len || 1, bytes.length - k))).join('');
      throw new UrlError(`"${shown}" at position ${start + k * 3 + 1} isn't valid UTF-8.`, start + k * 3 + 1);
    }
    out += mode === 'full' && len === 1 && RESERVED.has(ch) ? raws[k] : ch;
    k += len;
  }
  return out;
}

const PARTS = ['protocol', 'username', 'password', 'host', 'port', 'path', 'query', 'hash', 'origin'];

/**
 * Splits text into URL parts. Accepts a full URL, or a bare query string ("?a=1&b=2" or "a=1&b=2").
 * Returns { kind: 'url'|'query', parts, params } where params is a list of [key, value] (decoded).
 * Throws UrlError when the text is neither.
 */
export function parseUrl(text) {
  const str = String(text).trim();
  if (!str) throw new UrlError('Paste a URL to take it apart.', 0);
  let url;
  try {
    url = new URL(str);
  } catch {
    url = null;
  }
  if (url) {
    const parts = {
      protocol: url.protocol,
      username: decodeSafe(url.username),
      password: decodeSafe(url.password),
      host: url.hostname,
      port: url.port,
      path: url.pathname,
      query: url.search,
      hash: url.hash,
      origin: url.origin === 'null' ? '' : url.origin,
    };
    return { kind: 'url', parts, params: [...url.searchParams] };
  }
  if (/^\?/.test(str) || (/=/.test(str) && !/[\s/:]/.test(str.split('=')[0]))) {
    const query = str.replace(/^\?/, '');
    return { kind: 'query', parts: { query: `?${query}` }, params: [...new URLSearchParams(query)] };
  }
  if (/^[\w-]+(\.[\w-]+)+(?::\d+)?(?:[/?#]|$)/.test(str)) {
    throw new UrlError(`This has no scheme. Add one at the start, for example https://${str}`, 1);
  }
  throw new UrlError('This isn\'t a URL the browser can read. A URL starts with a scheme such as https://', 1);
}

function decodeSafe(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The order in which parseUrl's parts are shown. */
export const PART_NAMES = PARTS;

/**
 * Rebuilds a URL (or bare query string) with a new list of [key, value] params.
 * Rows with an empty key and empty value are skipped. Values are form-encoded (space as +).
 */
export function rebuildUrl(text, params) {
  const search = new URLSearchParams(params.filter(([key, value]) => key !== '' || value !== '')).toString();
  const str = String(text).trim();
  let url;
  try {
    url = new URL(str);
  } catch {
    return search ? `?${search}` : '';
  }
  url.search = search;
  return url.href;
}
