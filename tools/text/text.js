// Text transforms and counts. No DOM access, so Node tests can import it.

const hasSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
const graphemeSegmenter = hasSegmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const wordSegmenter = hasSegmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
const encoder = new TextEncoder();

// ---------- Case ----------

/**
 * Splits text into words for programmer cases: breaks at spaces, punctuation and case changes,
 * keeping acronyms together ("XMLHttpRequest" → XML, Http, Request). Apostrophes are dropped.
 */
export function splitWords(text) {
  return String(text).replace(/['’]/g, '')
    .match(/\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?[\p{Ll}\p{M}]+|\p{Lu}[\p{Lu}\p{M}]*|\p{N}+|[\p{L}\p{M}]+/gu) || [];
}

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

// Applies fn to each line so multi-line input keeps its shape.
const perLine = (text, fn) => String(text).split(/(\r?\n)/).map((part, i) => (i % 2 ? part : fn(part))).join('');

const joinWords = (sep, map) => (text) => perLine(text, (line) => splitWords(line).map(map).join(sep));

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'vs', 'via']);

/** Title Case: capitalizes each word, keeping short words like "of" and "the" lower case mid-line. */
export function titleCase(text) {
  return perLine(text, (line) => {
    const parts = line.toLowerCase().split(/(\s+)/);
    const wordIndexes = parts.map((part, i) => (/\S/.test(part) ? i : -1)).filter((i) => i >= 0);
    const first = wordIndexes[0];
    const last = wordIndexes[wordIndexes.length - 1];
    return parts.map((part, i) => {
      if (!/\S/.test(part)) return part;
      const bare = part.replace(/[^\p{L}]/gu, '');
      if (i !== first && i !== last && SMALL_WORDS.has(bare)) return part;
      return part.replace(/\p{L}/u, (ch) => ch.toUpperCase());
    }).join('');
  });
}

/** Sentence case: lower case, with a capital at the start of each sentence and line. */
export function sentenceCase(text) {
  return String(text).toLowerCase().replace(/(^\s*|[.!?]\s+|\n\s*)(\p{L})/gu, (_, before, ch) => before + ch.toUpperCase());
}

/** Case conversions by id. Programmer cases work line by line. */
export const CASES = {
  lower: (text) => String(text).toLowerCase(),
  upper: (text) => String(text).toUpperCase(),
  title: titleCase,
  sentence: sentenceCase,
  camel: (text) => perLine(text, (line) => splitWords(line).map((w, i) => (i ? capitalize(w) : w.toLowerCase())).join('')),
  pascal: joinWords('', capitalize),
  snake: joinWords('_', (w) => w.toLowerCase()),
  kebab: joinWords('-', (w) => w.toLowerCase()),
  constant: joinWords('_', (w) => w.toUpperCase()),
  dot: joinWords('.', (w) => w.toLowerCase()),
};

/** Converts text to a case: lower, upper, title, sentence, camel, pascal, snake, kebab, constant or dot. */
export function convertCase(text, kind) {
  const fn = CASES[kind];
  if (!fn) throw new Error(`Unknown case "${kind}".`);
  return fn(text);
}

// Letters that Unicode normalization doesn't split into a base letter and an accent.
const FOLD = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ł: 'l', ı: 'i', ħ: 'h' };

/** Removes accents: "Héllo Wörld" → "Hello World", "Straße" → "Strasse". */
export function stripDiacritics(text) {
  return String(text).normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[ßæœøđðþłıħ]/gi, (ch) => {
      const folded = FOLD[ch.toLowerCase()];
      return ch === ch.toLowerCase() ? folded : folded.charAt(0).toUpperCase() + folded.slice(1);
    });
}

/** URL slug of each line: lower case ASCII letters and digits joined by hyphens. */
export function slugify(text) {
  return perLine(text, (line) => stripDiacritics(line).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
}

// ---------- Lines ----------

// Splits into lines, setting aside one final line break so it stays at the end.
function withLines(text, fn) {
  const source = String(text);
  if (source === '') return '';
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const trailing = /\r?\n$/.test(source);
  const body = trailing ? source.replace(/\r?\n$/, '') : source;
  const lines = fn(body.split(/\r?\n/));
  return lines.join(newline) + (trailing && lines.length ? newline : '');
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Sorts lines: 'az', 'za' or 'natural' (numbers compare by value, so file2 comes before file10). */
export function sortLines(text, order = 'az') {
  const compare = order === 'natural' ? naturalCollator.compare : collator.compare;
  return withLines(text, (lines) => {
    // Ties fall back to code point order so the result doesn't depend on input order.
    const sorted = lines.slice().sort((a, b) => compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
    return order === 'za' ? sorted.reverse() : sorted;
  });
}

export const reverseLines = (text) => withLines(text, (lines) => lines.slice().reverse());

/** An unbiased random integer in [0, max) from crypto.getRandomValues. */
export function randomInt(max, random = crypto) {
  if (max <= 1) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  while (true) {
    random.getRandomValues(buffer);
    if (buffer[0] < limit) return buffer[0] % max;
  }
}

/** Shuffles lines with Fisher–Yates and a cryptographic random source. */
export function shuffleLines(text, random = crypto) {
  return withLines(text, (lines) => {
    const out = lines.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = randomInt(i + 1, random);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  });
}

/** Removes repeated lines, keeping the first. ignoreCase treats "A" and "a" as the same line. */
export function dedupeLines(text, { ignoreCase = false } = {}) {
  return withLines(text, (lines) => {
    const seen = new Set();
    return lines.filter((line) => {
      const key = ignoreCase ? line.toLowerCase() : line;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
}

/** Drops lines that are empty or only whitespace. */
export const removeEmptyLines = (text) => withLines(text, (lines) => lines.filter((line) => /\S/.test(line)));

export const trimLines = (text) => withLines(text, (lines) => lines.map((line) => line.trim()));

/** Prefixes each line with its number, right-aligned: " 9. …", "10. …". */
export function numberLines(text) {
  return withLines(text, (lines) => {
    const width = String(lines.length).length;
    return lines.map((line, i) => `${String(i + 1).padStart(width, ' ')}. ${line}`);
  });
}

// ---------- Whitespace ----------

export const trimText = (text) => String(text).trim();

/** Turns runs of spaces and tabs into one space. Line breaks stay. */
export const collapseSpaces = (text) => String(text).replace(/[^\S\r\n]+/g, ' ');

/** Joins all lines into one, with a single space where each break was. */
export const removeLineBreaks = (text) => String(text).replace(/\s*(?:\r\n|\r|\n)\s*/g, ' ').trim();

// ---------- Counts ----------

/** Number of user-perceived characters (a family emoji or "é" with a combining accent is 1). */
export function countGraphemes(text) {
  if (!graphemeSegmenter) return Array.from(String(text)).length;
  let count = 0;
  for (const _ of graphemeSegmenter.segment(String(text))) count++;
  return count;
}

/** Counts words, letters in scripts without spaces included, using the word segmenter. */
export function countWords(text) {
  if (!wordSegmenter) return (String(text).match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || []).length;
  let count = 0;
  for (const segment of wordSegmenter.segment(String(text))) if (segment.isWordLike) count++;
  return count;
}

/** Lines in the text. A final line break doesn't start a new line; empty text has 0. */
export function countLines(text) {
  const source = String(text);
  if (!source) return 0;
  return source.replace(/\r?\n$/, '').split(/\r\n|\r|\n/).length;
}

/** Blocks of text separated by blank lines. */
export const countParagraphs = (text) => String(text).split(/(?:\r?\n|\r)[^\S\r\n]*(?:\r?\n|\r)/).filter((block) => /\S/.test(block)).length;

/** Reading time in whole minutes at `wpm` words a minute, rounded up (0 for no words). */
export const readingMinutes = (words, wpm = 238) => Math.ceil(words / wpm);

/** All the counts the page shows. */
export function stats(text) {
  const source = String(text);
  const words = countWords(source);
  return {
    characters: countGraphemes(source),
    charactersNoSpaces: countGraphemes(source.replace(/\s+/g, '')),
    words,
    lines: countLines(source),
    paragraphs: countParagraphs(source),
    bytes: encoder.encode(source).length,
    readingMinutes: readingMinutes(words),
  };
}

/** "Under 1 min" style label for reading time. */
export function formatReadingTime(minutes, words) {
  if (!words) return '0 min';
  if (minutes <= 1) return words < 120 ? 'Under 1 min' : '1 min';
  return `${minutes.toLocaleString('en-US')} min`;
}

// ---------- Dispatcher ----------

/** Every transform the page offers, by id. */
export const TRANSFORMS = {
  ...Object.fromEntries(Object.entries(CASES).map(([id, fn]) => [`case-${id}`, fn])),
  slug: slugify,
  'sort-az': (text) => sortLines(text, 'az'),
  'sort-za': (text) => sortLines(text, 'za'),
  'sort-natural': (text) => sortLines(text, 'natural'),
  reverse: reverseLines,
  shuffle: (text) => shuffleLines(text),
  dedupe: (text, options) => dedupeLines(text, options),
  'remove-empty': removeEmptyLines,
  'trim-lines': trimLines,
  number: numberLines,
  trim: trimText,
  'collapse-spaces': collapseSpaces,
  'remove-breaks': removeLineBreaks,
};

/** Runs a transform by id. options: { ignoreCase } for dedupe. */
export function transform(text, id, options = {}) {
  const fn = TRANSFORMS[id];
  if (!fn) throw new Error(`Unknown transform "${id}".`);
  return fn(text, options);
}
