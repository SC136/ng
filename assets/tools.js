// The tool registry. The hub, /tools/, the command palette and scripts/check.mjs all read it.
// Order here is display order.

export const CATEGORIES = [
  { id: 'encode', name: 'Encode & decode' },
  { id: 'text', name: 'Text' },
  { id: 'generate', name: 'Generate' },
  { id: 'time', name: 'Time' },
  { id: 'media', name: 'Color & images' },
  { id: 'hardware', name: 'Hardware & bits' },
  { id: 'site', name: 'This site' },
];

export const TOOLS = [
  {
    slug: 'json', name: 'JSON', cat: 'encode',
    blurb: 'Format, minify and validate JSON, with exact error positions.',
    keywords: ['format', 'prettify', 'beautify', 'minify', 'validate', 'lint', 'sort keys', 'jsonc'],
  },
  {
    slug: 'base64', name: 'Base64', cat: 'encode',
    blurb: 'Encode and decode Base64 text and files, URL-safe too.',
    keywords: ['encode', 'decode', 'data url', 'btoa', 'atob', 'file'],
  },
  {
    slug: 'url', name: 'URL', cat: 'encode',
    blurb: 'Percent-encode and decode, and take URLs and query strings apart.',
    keywords: ['encode', 'decode', 'percent', 'query string', 'params', 'parse', 'uri'],
  },
  {
    slug: 'jwt', name: 'JWT', cat: 'encode',
    blurb: 'Decode JSON Web Tokens, read their claims and verify signatures.',
    keywords: ['token', 'decode', 'verify', 'sign', 'hs256', 'rs256', 'claims', 'bearer'],
  },
  {
    slug: 'hash', name: 'Hash', cat: 'encode',
    blurb: 'MD5, SHA and CRC32 checksums for text and files, plus HMAC.',
    keywords: ['md5', 'sha1', 'sha256', 'sha512', 'checksum', 'hmac', 'crc32', 'digest'],
  },
  {
    slug: 'diff', name: 'Diff', cat: 'text',
    blurb: 'Compare two texts line by line, with changed words highlighted.',
    keywords: ['compare', 'difference', 'patch', 'unified', 'changes'],
  },
  {
    slug: 'regex', name: 'Regex', cat: 'text',
    blurb: 'Test JavaScript regular expressions, groups and replacements.',
    keywords: ['regexp', 'regular expression', 'match', 'replace', 'pattern', 'groups'],
  },
  {
    slug: 'text', name: 'Text', cat: 'text',
    blurb: 'Change case, make slugs, count words, sort and dedupe lines.',
    keywords: ['case', 'camelcase', 'snake case', 'kebab', 'slug', 'word count', 'sort lines', 'dedupe', 'trim'],
  },
  {
    slug: 'uuid', name: 'UUID', cat: 'generate',
    blurb: 'Generate UUID v4 and v7, ULIDs and nanoids, or inspect one.',
    keywords: ['guid', 'uuidv4', 'uuidv7', 'ulid', 'nanoid', 'id', 'random'],
  },
  {
    slug: 'password', name: 'Password', cat: 'generate',
    blurb: 'Strong random passwords and PINs, with an honest strength estimate.',
    keywords: ['generator', 'random', 'pin', 'secure', 'entropy', 'passphrase'],
  },
  {
    slug: 'qr', name: 'QR code', cat: 'generate',
    blurb: 'QR codes for links, text, Wi-Fi and email. Download SVG or PNG.',
    keywords: ['qr', 'barcode', 'wifi', 'share', 'scan'],
  },
  {
    slug: 'time', name: 'Timestamp', cat: 'time',
    blurb: 'Convert Unix timestamps, compare time zones, build Discord timestamps.',
    keywords: ['unix', 'epoch', 'date', 'timezone', 'discord', 'iso 8601', 'utc'],
  },
  {
    slug: 'cron', name: 'Cron', cat: 'time',
    blurb: 'Read cron expressions in plain English and see when they run next.',
    keywords: ['crontab', 'schedule', 'github actions', 'next run', 'cron job'],
  },
  {
    slug: 'color', name: 'Color', cat: 'media',
    blurb: 'Convert HEX, RGB, HSL and OKLCH, check contrast, build shades.',
    keywords: ['colour', 'hex', 'rgb', 'hsl', 'oklch', 'contrast', 'wcag', 'palette', 'shades'],
  },
  {
    slug: 'image', name: 'Image', cat: 'media',
    blurb: 'Convert, resize and compress images to WebP, JPEG or PNG.',
    keywords: ['compress', 'convert', 'resize', 'webp', 'jpeg', 'png', 'avif', 'optimize', 'photo'],
  },
  {
    slug: 'bits', name: 'Bits', cat: 'hardware',
    blurb: "Number bases, two's complement and IEEE-754 floats, bit by bit.",
    keywords: ['binary', 'hex', 'octal', 'decimal', 'base', 'twos complement', 'float', 'ieee 754', 'bitwise'],
  },
  {
    slug: 'resistor', name: 'Resistor', cat: 'hardware',
    blurb: 'Read resistor color bands, or find the bands for a value.',
    keywords: ['color code', 'colour code', 'bands', 'ohm', 'e24', 'e96', 'electronics'],
  },
  {
    slug: 'ohm', name: "Ohm's law", cat: 'hardware',
    blurb: "Ohm's law, voltage dividers, LED resistors, series and parallel.",
    keywords: ['ohms law', 'voltage divider', 'led resistor', 'series', 'parallel', 'power', 'electronics', 'circuit'],
  },
  {
    slug: 'lipo', name: 'LiPo', cat: 'hardware',
    blurb: 'Battery pack voltages, max current, energy and flight-time estimates.',
    keywords: ['battery', 'drone', 'flight time', 'mah', 'c rating', 'cells', 'voltage', 'fpv', 'li-ion'],
  },
  {
    slug: 'links', name: 'Short links', cat: 'site',
    blurb: 'Every ng.foo.ng short link, and a helper for adding new ones.',
    keywords: ['links', 'redirect', 'shortener', 'url shortener', 'go links'],
  },
];

export const toolUrl = (tool) => `/tools/${tool.slug}/`;

/**
 * Filters and ranks tools for a search query. Every word must match somewhere;
 * name and slug matches rank above keyword and description matches. Ties keep registry order.
 */
export function searchTools(query, tools = TOOLS) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return tools.slice();
  return tools
    .map((tool) => ({ tool, score: scoreTool(tool, words) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.tool);
}

function scoreTool(tool, words) {
  const name = tool.name.toLowerCase();
  const keywords = tool.keywords || [];
  const haystack = [tool.slug, name, tool.blurb.toLowerCase(), ...keywords].join(' ');
  let total = 0;
  for (const word of words) {
    let score = 0;
    if (name === word || tool.slug === word) score = 100;
    else if (name.startsWith(word) || tool.slug.startsWith(word)) score = 70;
    else if (keywords.some((keyword) => keyword.startsWith(word))) score = 50;
    else if (haystack.includes(word)) score = 30;
    if (!score) return 0;
    total += score;
  }
  return total;
}
