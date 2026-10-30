// Short-link logic for ng.foo.ng/<slug>. Pure: used by 404.html, the links page and Node tests.
// links.json maps a slug to a target URL. GitHub Pages serves 404.html for unknown paths,
// and that page calls resolveShortLink() and redirects.

export const SITE = 'https://ng.foo.ng';
export const LINKS_FILE = '/links.json';
export const EDIT_URL = 'https://github.com/SC136/ng/edit/main/links.json';

// Top-level names that are real paths on the site (or might become one), so they can't be slugs.
export const RESERVED = new Set([
  '404', 'assets', 'cname', 'docs', 'favicon.ico', 'index', 'index.html', 'lab', 'links.json',
  'node_modules', 'package.json', 'readme', 'readme.md', 'robots.txt', 'scripts', 'sitemap.xml',
  'tests', 'tools',
]);

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Lowercases and trims a slug the way URLs are matched. */
export const normalizeSlug = (slug) => String(slug ?? '').trim().replace(/^\/+|\/+$/g, '').toLowerCase();

/**
 * Checks a slug for links.json: 1–64 lowercase letters, digits or inner hyphens, not reserved,
 * not already taken. Returns { ok: true } or { ok: false, error }.
 */
export function validateSlug(slug, links = {}) {
  const s = normalizeSlug(slug);
  if (!s) return { ok: false, error: 'Enter a slug.' };
  if (!SLUG.test(s)) {
    return { ok: false, error: 'Use 1–64 lowercase letters, digits and hyphens, with no hyphen at either end.' };
  }
  if (RESERVED.has(s)) return { ok: false, error: `"${s}" is a real path on this site, so it can't be a short link.` };
  if (Object.keys(links).some((key) => key.toLowerCase() === s)) return { ok: false, error: `"${s}" is already taken.` };
  return { ok: true };
}

/** Checks a link target: an absolute http(s) or mailto URL. Returns { ok: true } or { ok: false, error }. */
export function validateTarget(target) {
  let url;
  try {
    url = new URL(String(target ?? '').trim());
  } catch {
    return { ok: false, error: 'Enter a full URL, starting with https://' };
  }
  if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) {
    return { ok: false, error: 'Only https://, http:// and mailto: links are allowed.' };
  }
  if (url.protocol !== 'mailto:' && !url.hostname) return { ok: false, error: 'That URL has no host name.' };
  return { ok: true };
}

/**
 * Works out where a short-link path should redirect, or returns null when it isn't one.
 *   /gh                → links.gh
 *   /GH/               → links.gh (case and trailing slash don't matter)
 *   /gh/ng             → links.gh + "/ng" (extra path is appended for http(s) targets without ? or #)
 *   /gh?tab=repos#top  → query is merged into the target; the hash is kept if the target has none
 */
export function resolveShortLink(pathname, search, hash, links) {
  const segments = String(pathname ?? '').split('/').filter(Boolean);
  if (!segments.length) return null;
  let slug;
  try {
    slug = decodeURIComponent(segments[0]).toLowerCase();
  } catch {
    return null;
  }
  const key = Object.keys(links || {}).find((name) => name.toLowerCase() === slug);
  if (!key) return null;
  const target = String(links[key]).trim();
  if (!validateTarget(target).ok) return null;

  const url = new URL(target);
  if (url.protocol === 'mailto:') return url.href;

  const rest = segments.slice(1);
  if (rest.length && !url.search && !url.hash) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${rest.join('/')}`;
  }
  for (const [name, value] of new URLSearchParams(search || '')) url.searchParams.append(name, value);
  if (hash && hash !== '#' && !url.hash) url.hash = hash;
  return url.href;
}

/** Turns links.json content into a sorted list of { slug, url, short, error } rows. */
export function listLinks(links) {
  return Object.entries(links || {})
    .map(([slug, url]) => {
      const target = validateTarget(url);
      const slugError = SLUG.test(slug) && !RESERVED.has(slug) ? null : 'Invalid slug';
      return { slug, url: String(url), short: `${SITE}/${slug}`, error: slugError || (target.ok ? null : target.error) };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}
