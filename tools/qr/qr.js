// QR code payload builders and rendering helpers. No DOM access, so Node tests can import it.
// Encoding itself is done by the qrcode-generator library in the page; rendering here works on
// any { size, isDark(row, col) } matrix.

export const MAX_TEXT = 2953; // Bytes a version 40-L code can hold.

const WIFI_SPECIAL = /([\\;,:"])/g;

/** Escapes a value for a WIFI: payload: backslash, semicolon, comma, colon and double quote. */
export const escapeWifi = (value) => String(value).replace(WIFI_SPECIAL, '\\$1');

/**
 * Builds a Wi-Fi network payload, e.g. WIFI:T:WPA;S:home;P:secret;;
 * auth: 'WPA' | 'WEP' | 'nopass'. The password is left out for open networks.
 */
export function wifiPayload({ ssid = '', password = '', auth = 'WPA', hidden = false } = {}) {
  if (!ssid) throw new Error('Enter the network name (SSID).');
  if (auth !== 'nopass' && !password) throw new Error('Enter the password, or choose no password.');
  let out = `WIFI:T:${auth};S:${escapeWifi(ssid)};`;
  if (auth !== 'nopass') out += `P:${escapeWifi(password)};`;
  if (hidden) out += 'H:true;';
  return `${out};`;
}

/** Builds a mailto: link with optional subject and body (RFC 6068 percent-encoding). */
export function mailtoPayload({ to = '', subject = '', body = '' } = {}) {
  const address = String(to).trim();
  if (!address) throw new Error('Enter an email address.');
  // Keep @ readable; encode everything else that isn't safe in the address part.
  const encodedTo = encodeURIComponent(address).replace(/%40/g, '@').replace(/%2C/g, ',');
  const params = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  // Line breaks in the body must be CRLF.
  if (body) params.push(`body=${encodeURIComponent(String(body).replace(/\r?\n/g, '\r\n'))}`);
  return `mailto:${encodedTo}${params.length ? `?${params.join('&')}` : ''}`;
}

/** Converts text to a "binary string": its UTF-8 bytes, one char (U+0000–U+00FF) per byte. */
export function utf8BinaryString(text) {
  const bytes = new TextEncoder().encode(String(text));
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return out;
}

/**
 * Turns a module matrix into one SVG path. Runs of dark modules in a row become one rectangle.
 * Coordinates are in modules, offset by the margin.
 */
export function matrixToPath(matrix, margin = 0) {
  const parts = [];
  for (let row = 0; row < matrix.size; row++) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < matrix.size && matrix.isDark(row, col)) col++;
      const run = col - start;
      parts.push(`M${start + margin} ${row + margin}h${run}v1h-${run}z`);
    }
  }
  return parts.join('');
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Builds a complete SVG document for the matrix. Colors are #rrggbb. */
export function matrixToSvg(matrix, { margin = 4, fg = '#000000', bg = '#ffffff' } = {}) {
  if (!HEX.test(fg) || !HEX.test(bg)) throw new Error('Colors must be in #rrggbb form.');
  const total = matrix.size + margin * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`
    + `<rect width="${total}" height="${total}" fill="${bg}"/>`
    + `<path fill="${fg}" d="${matrixToPath(matrix, margin)}"/></svg>`;
}

/**
 * Pixel edges for drawing `modules` cells across `pixels` pixels without gaps or blur:
 * returns modules + 1 integer positions from 0 to pixels.
 */
export function cellEdges(modules, pixels) {
  return Array.from({ length: modules + 1 }, (_, i) => Math.round((i * pixels) / modules));
}

const channel = (value) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of a #rrggbb color. */
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two #rrggbb colors (1 to 21). */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Warns about color pairs that scanners struggle with. Returns a message, or '' when fine.
 */
export function colorWarning(fg, bg) {
  const ratio = contrastRatio(fg, bg);
  if (ratio < 4) return `Contrast is only ${ratio.toFixed(1)}:1. Many scanners need a darker foreground on a lighter background.`;
  if (luminance(fg) > luminance(bg)) return 'Light modules on a dark background are inverted. Some scanners can\'t read them.';
  return '';
}
