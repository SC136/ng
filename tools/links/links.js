// Short links page logic. Builds on the shared short-link rules in assets/links.js.
// No DOM access, so Node tests can import it.
import {
  EDIT_URL, LINKS_FILE, SITE, listLinks, normalizeSlug, resolveShortLink, validateSlug, validateTarget,
} from '../../assets/links.js';

export { EDIT_URL, LINKS_FILE, SITE, listLinks, normalizeSlug, resolveShortLink, validateSlug, validateTarget };

/**
 * Checks parsed links.json content: an object mapping slugs to URL strings. Returns it, or throws.
 */
export function checkLinksData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('links.json should be an object of "slug": "url" pairs.');
  for (const [slug, url] of Object.entries(data)) {
    if (typeof url !== 'string') throw new Error(`The link "${slug}" should point to a URL string.`);
  }
  return data;
}

/**
 * Filters listLinks() rows by a search query. Every word must appear in the slug, short URL or target.
 */
export function filterLinks(rows, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows.slice();
  return rows.filter((row) => {
    const haystack = `${row.slug} ${row.short} ${row.url}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** The QR tool link for a URL: /tools/qr/#text=<encoded URL>. */
export const qrHref = (url) => `/tools/qr/#text=${encodeURIComponent(url)}`;

/** "ng.foo.ng/gh" — the short URL without the scheme, for display. */
export const displayShort = (short) => short.replace(/^https?:\/\//, '');

/**
 * The JSON line to add to links.json for a new link, placed in alphabetical order.
 * Returns { line, after, last }: `after` is the slug it goes after (null for first),
 * `last` is true when it becomes the final entry, so it has no trailing comma and the line before it needs one.
 */
export function jsonLine(slug, url, links = {}) {
  const key = normalizeSlug(slug);
  const keys = Object.keys(links).sort((a, b) => a.localeCompare(b));
  const before = keys.filter((existing) => existing.localeCompare(key) < 0);
  const last = before.length === keys.length;
  const line = `  ${JSON.stringify(key)}: ${JSON.stringify(String(url).trim())}${last ? '' : ','}`;
  return { line, after: before.length ? before[before.length - 1] : null, last };
}

/**
 * Validates a proposed link against the loaded links. Returns
 * { slug: { ok, error }, target: { ok, error }, ok, short, snippet } where snippet is jsonLine() when ok.
 */
export function checkNewLink(slug, url, links = {}) {
  const slugResult = validateSlug(slug, links);
  const targetResult = validateTarget(url);
  const ok = slugResult.ok && targetResult.ok;
  const key = normalizeSlug(slug);
  return {
    slug: slugResult,
    target: targetResult,
    ok,
    short: key ? `${SITE}/${key}` : '',
    snippet: ok ? jsonLine(key, url, links) : null,
  };
}

/** Explains where a snippet goes, in plain words. */
export function placementHint(snippet) {
  if (!snippet.after) return 'Add it as the first entry, right after the opening {.';
  if (snippet.last) return `Add it at the end, after "${snippet.after}", and put a comma after the "${snippet.after}" line.`;
  return `Add it after the "${snippet.after}" line.`;
}
