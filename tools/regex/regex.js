// Regular expression logic. No DOM access, so Node tests and the worker can import it.

/** Flags in the order JavaScript prints them, with a short description each. */
export const FLAGS = [
  { flag: 'd', name: 'indices', about: 'Record where each group starts and ends' },
  { flag: 'g', name: 'global', about: 'Find every match, not just the first' },
  { flag: 'i', name: 'ignore case', about: 'Letters match in either case' },
  { flag: 'm', name: 'multiline', about: '^ and $ match at each line break' },
  { flag: 's', name: 'dot all', about: '. also matches line breaks' },
  { flag: 'u', name: 'unicode', about: 'Treat the pattern as Unicode code points' },
  { flag: 'v', name: 'unicode sets', about: 'Unicode mode with set operations in classes' },
  { flag: 'y', name: 'sticky', about: 'Match only at the current position' },
];

/** Flags this JavaScript engine accepts (v is newer than the rest). */
export function supportedFlags() {
  return FLAGS.map(({ flag }) => flag).filter((flag) => {
    try {
      new RegExp('', flag);
      return true;
    } catch {
      return false;
    }
  });
}

/** Turns an engine error like "Invalid regular expression: /(/: Unterminated group" into "Unterminated group". */
export function cleanError(error) {
  const message = String(error?.message ?? error);
  const match = /^Invalid regular expression: \/[\s\S]*\/[a-z]*: ([\s\S]+)$/.exec(message);
  const text = (match ? match[1] : message.replace(/^Invalid regular expression: /, '')).trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Compiles a pattern and flags into a RegExp. Throws an Error with a readable message for
 * bad patterns, unknown or repeated flags, and u together with v.
 */
export function compile(pattern, flags = '') {
  const seen = new Set();
  for (const flag of flags) {
    if (!FLAGS.some((item) => item.flag === flag)) throw new Error(`"${flag}" isn't a regular expression flag.`);
    if (seen.has(flag)) throw new Error(`The "${flag}" flag is repeated.`);
    seen.add(flag);
  }
  if (seen.has('u') && seen.has('v')) throw new Error('Use either the u or the v flag, not both.');
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(cleanError(error));
  }
}

/** Formats a pattern as a /literal/ with its flags, escaping bare slashes and line breaks. */
export function toLiteral(pattern, flags = '') {
  return `/${new RegExp(pattern, flags).source}/${flags}`;
}

/**
 * Lists capture groups in pattern order: index 0 is group 1. Each entry is the group's name,
 * or null for an unnamed group. Lookarounds and (?:…) are skipped.
 */
export function groupNames(source) {
  const names = [];
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch !== '(') continue;
    if (source[i + 1] !== '?') {
      names.push(null);
      continue;
    }
    const named = /^\(\?<([^>=!][^>]*)>/.exec(source.slice(i));
    if (named) names.push(named[1]);
  }
  return names;
}

/** The index after `index`, stepping over a whole surrogate pair in Unicode mode. */
export function advanceIndex(text, index, unicode) {
  if (!unicode || index + 1 >= text.length) return index + 1;
  const code = text.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = text.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return index + 2;
  }
  return index + 1;
}

/**
 * Runs a regex over text like the engine would for exec() in a loop: every match with the g
 * flag, otherwise only the first (y keeps matches contiguous). Empty matches advance by one
 * character so the loop always ends. Stops after `limit` matches.
 * Returns { matches, truncated }. Each match is
 * { index, end, text, groups: [{ number, name, value, start, end }] } where value, start and end
 * are undefined for groups that didn't take part.
 */
export function matchAll(regex, text, { limit = 1000 } = {}) {
  const flags = regex.flags.includes('d') ? regex.flags : `${regex.flags}d`;
  const re = new RegExp(regex.source, flags);
  const global = regex.flags.includes('g');
  const unicode = regex.unicode || regex.unicodeSets === true;
  const names = groupNames(regex.source);
  const matches = [];
  let truncated = false;
  re.lastIndex = 0;
  while (true) {
    const m = re.exec(text);
    if (!m) break;
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    matches.push({
      index: m.index,
      end: m.index + m[0].length,
      text: m[0],
      groups: m.slice(1).map((value, i) => ({
        number: i + 1,
        name: names[i] ?? null,
        value,
        start: m.indices[i + 1]?.[0],
        end: m.indices[i + 1]?.[1],
      })),
    });
    if (!global) break;
    if (m[0] === '') re.lastIndex = advanceIndex(text, re.lastIndex, unicode);
  }
  return { matches, truncated };
}

/**
 * Splits text into pieces for highlighting: { text, match } where match is the match's
 * position in the list or null. Empty matches become { text: '', match, empty: true } so they
 * can be drawn as a marker.
 */
export function segments(text, matches) {
  const out = [];
  let pos = 0;
  matches.forEach((m, i) => {
    if (m.index < pos) return;
    if (m.index > pos) out.push({ text: text.slice(pos, m.index), match: null });
    if (m.end === m.index) out.push({ text: '', match: i, empty: true });
    else out.push({ text: text.slice(m.index, m.end), match: i });
    pos = m.end;
  });
  if (pos < text.length) out.push({ text: text.slice(pos), match: null });
  return out;
}

/**
 * Replaces like String.prototype.replace: every match with g, otherwise the first.
 * The replacement understands $1, $<name>, $&, $`, $' and $$.
 */
export function replacePreview(regex, text, replacement) {
  const re = new RegExp(regex.source, regex.flags);
  return text.replace(re, replacement);
}

/** How many capture groups a regex has, counted by the engine itself. */
export function groupCount(regex) {
  return new RegExp(`(?:${regex.source})|`, regex.flags.replace(/[gy]/g, '')).exec('').length - 1;
}

/** Runs everything the page shows for one input. Used by the worker. */
export function run({ pattern, flags, text, replacement, limit = 1000 }) {
  const regex = compile(pattern, flags);
  const { matches, truncated } = matchAll(regex, text, { limit });
  const preview = replacement == null ? null : replacePreview(regex, text, replacement);
  return { matches, truncated, preview, groupCount: groupCount(regex), names: groupNames(regex.source) };
}
