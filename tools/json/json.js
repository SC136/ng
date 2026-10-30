// JSON logic: a small tokenizer/parser that keeps numbers as written and keys in order,
// plus a printer, key sorting, stats, code frames and string escaping. No DOM access.

/** Deepest nesting the parser and printer accept. Keeps recursion well inside the stack. */
export const MAX_DEPTH = 1000;

/** A parse error with a 0-based offset and 1-based line and column. */
export class JsonError extends Error {
  constructor(message, offset, text) {
    const { line, column } = lineCol(text, offset);
    super(message);
    this.name = 'JsonError';
    this.offset = offset;
    this.line = line;
    this.column = column;
  }
}

/** 1-based line and column of a 0-based offset. */
export function lineCol(text, offset) {
  let line = 1;
  let start = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      start = i + 1;
    }
  }
  return { line, column: offset - start + 1 };
}

const describe = (ch) => {
  if (ch === undefined) return 'the end of the input';
  if (ch === '\n') return 'a line break';
  if (ch === '\t') return 'a tab';
  if (ch === "'") return 'a single quote (JSON strings use double quotes)';
  const code = ch.codePointAt(0);
  if (code < 0x20 || code === 0x7f) return `control character U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  return `"${ch}"`;
};

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * Parses JSON text into a lossless tree.
 * Nodes: { type: 'object', entries: [{ key, keyRaw, value }] }, { type: 'array', items },
 * { type: 'string', value, raw }, { type: 'number', raw }, { type: 'literal', raw: 'true'|'false'|'null' }.
 * options.jsonc allows // and block comments and trailing commas.
 * Returns { tree, duplicates } where duplicates counts repeated keys within one object.
 * Throws JsonError with a position on invalid input.
 */
export function parseJson(text, { jsonc = false } = {}) {
  const src = String(text);
  let pos = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  let duplicates = 0;
  const fail = (message, at = pos) => {
    throw new JsonError(message, at, src);
  };

  function skip() {
    for (;;) {
      const c = src[pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        pos++;
      } else if (c === '/' && (src[pos + 1] === '/' || src[pos + 1] === '*')) {
        if (!jsonc) fail('Comments aren\'t allowed in JSON. Turn on "Allow comments and trailing commas" to accept them.');
        if (src[pos + 1] === '/') {
          while (pos < src.length && src[pos] !== '\n') pos++;
        } else {
          const end = src.indexOf('*/', pos + 2);
          if (end === -1) fail('This comment is never closed with */.');
          pos = end + 2;
        }
      } else {
        return;
      }
    }
  }

  function parseString() {
    const start = pos;
    pos++;
    let value = '';
    let chunk = pos;
    for (;;) {
      if (pos >= src.length) fail('This string is never closed. Add a " at the end.', start);
      const c = src.charCodeAt(pos);
      if (c === 34) break;
      if (c < 0x20) {
        fail(c === 10 ? 'Strings can\'t contain a line break. Use \\n instead.' : `Strings can't contain ${describe(src[pos])}. Escape it.`);
      }
      if (c === 92) {
        value += src.slice(chunk, pos);
        const e = src[pos + 1];
        if (e === 'u') {
          const hex = src.slice(pos + 2, pos + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('\\u must be followed by four hex digits.');
          value += String.fromCharCode(parseInt(hex, 16));
          pos += 6;
        } else if (e !== undefined && Object.hasOwn(ESCAPES, e)) {
          value += ESCAPES[e];
          pos += 2;
        } else {
          fail(e === undefined ? 'This string is never closed. Add a " at the end.' : `"\\${e}" isn't a valid escape. Use \\\\ for a backslash.`);
        }
        chunk = pos;
        continue;
      }
      pos++;
    }
    value += src.slice(chunk, pos);
    pos++;
    return { type: 'string', value, raw: src.slice(start, pos) };
  }

  function parseNumber() {
    NUMBER.lastIndex = pos;
    const match = NUMBER.exec(src);
    const start = pos;
    if (!match || !match[0] || match[0] === '-') {
      fail(src[pos] === '-' ? 'A minus sign must be followed by a digit.' : `Unexpected ${describe(src[pos])}.`, src[pos] === '-' ? pos + 1 : pos);
    }
    pos += match[0].length;
    const next = src[pos];
    if (next !== undefined && /[0-9.eE+\-a-zA-Z_]/.test(next)) {
      if (/^-?0\d/.test(src.slice(start, pos + 1))) fail('Numbers can\'t have leading zeros.', start);
      if (next === '.' || next === 'e' || next === 'E') fail('A decimal point or exponent must be followed by a digit.', pos + 1);
      fail(`Unexpected ${describe(next)} in a number.`);
    }
    return { type: 'number', raw: match[0] };
  }

  function parseValue(depth) {
    skip();
    const c = src[pos];
    if (c === '{' || c === '[') {
      if (depth >= MAX_DEPTH) fail(`This is nested more than ${MAX_DEPTH} levels deep, which is too deep to show here.`);
      return c === '{' ? parseObject(depth + 1) : parseArray(depth + 1);
    }
    if (c === '"') return parseString();
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    for (const word of ['true', 'false', 'null']) {
      if (src.startsWith(word, pos)) {
        pos += word.length;
        return { type: 'literal', raw: word };
      }
    }
    if (c === undefined) fail('The input ended where a value was expected.');
    if (/[A-Za-z]/.test(c)) {
      const word = /[A-Za-z_$][\w$]*/y;
      word.lastIndex = pos;
      const found = word.exec(src)[0];
      const hint = { True: ' Use true.', False: ' Use false.', None: ' Use null.', NULL: ' Use null.', undefined: ' Use null.', NaN: ' JSON has no NaN.', Infinity: ' JSON has no Infinity.' }[found] || ' Strings need double quotes.';
      fail(`Unexpected word "${found}".${hint}`);
    }
    fail(`Unexpected ${describe(String.fromCodePoint(src.codePointAt(pos)))} where a value was expected.`);
  }

  function parseObject(depth) {
    const open = pos;
    pos++;
    const entries = [];
    const seen = new Set();
    let lastComma = -1;
    skip();
    if (src[pos] === '}') {
      pos++;
      return { type: 'object', entries };
    }
    for (;;) {
      skip();
      if (src[pos] !== '"') {
        if (src[pos] === '}' && entries.length) {
          if (!jsonc) fail('Trailing commas aren\'t allowed in JSON. Remove the comma before }.', lastComma);
          pos++;
          return { type: 'object', entries };
        }
        if (src[pos] === undefined) fail('The input ended inside an object. Close it with }.', open);
        fail(`Expected a property name in double quotes, found ${describe(src[pos])}.`);
      }
      const key = parseString();
      skip();
      if (src[pos] !== ':') fail(`Expected ":" after the property name, found ${describe(src[pos])}.`);
      pos++;
      const value = parseValue(depth);
      if (seen.has(key.value)) duplicates++;
      seen.add(key.value);
      entries.push({ key: key.value, keyRaw: key.raw, value });
      skip();
      if (src[pos] === ',') {
        lastComma = pos;
        pos++;
        continue;
      }
      if (src[pos] === '}') {
        pos++;
        return { type: 'object', entries };
      }
      if (src[pos] === undefined) fail('The input ended inside an object. Close it with }.', open);
      fail(`Expected "," or "}" after a property value, found ${describe(src[pos])}.`);
    }
  }

  function parseArray(depth) {
    const open = pos;
    pos++;
    const items = [];
    skip();
    if (src[pos] === ']') {
      pos++;
      return { type: 'array', items };
    }
    let lastComma = -1;
    for (;;) {
      skip();
      if (src[pos] === ']' && items.length) {
        if (!jsonc) fail('Trailing commas aren\'t allowed in JSON. Remove the comma before ].', lastComma);
        pos++;
        return { type: 'array', items };
      }
      if (src[pos] === ',') fail('Expected a value before this comma.');
      items.push(parseValue(depth));
      skip();
      if (src[pos] === ',') {
        lastComma = pos;
        pos++;
        continue;
      }
      if (src[pos] === ']') {
        pos++;
        return { type: 'array', items };
      }
      if (src[pos] === undefined) fail('The input ended inside an array. Close it with ].', open);
      fail(`Expected "," or "]" after an array item, found ${describe(src[pos])}.`);
    }
  }

  skip();
  if (pos >= src.length) fail('There is no JSON here, only whitespace.');
  const tree = parseValue(0);
  skip();
  if (pos < src.length) fail(`Unexpected ${describe(src[pos])} after the end of the JSON value.`);
  return { tree, duplicates };
}

/**
 * Prints a tree as JSON. indent: a number of spaces, '\t', or 0/'' for minified output.
 * Strings and numbers are printed exactly as they were written.
 */
export function printJson(tree, indent = 2) {
  const unit = typeof indent === 'number' ? ' '.repeat(indent) : indent || '';
  const parts = [];
  const nl = unit ? '\n' : '';
  const colon = unit ? ': ' : ':';
  function walk(node, pad) {
    if (node.type === 'object' || node.type === 'array') {
      const children = node.type === 'object' ? node.entries : node.items;
      const [open, close] = node.type === 'object' ? ['{', '}'] : ['[', ']'];
      if (!children.length) {
        parts.push(open + close);
        return;
      }
      const inner = pad + unit;
      parts.push(open);
      children.forEach((child, i) => {
        parts.push(i ? `,${nl}${inner}` : nl + inner);
        if (node.type === 'object') {
          parts.push(child.keyRaw, colon);
          walk(child.value, inner);
        } else {
          walk(child, inner);
        }
      });
      parts.push(nl + pad + close);
      return;
    }
    parts.push(node.raw);
  }
  walk(tree, '');
  return parts.join('');
}

/** Returns a copy of the tree with object keys sorted at every level. Arrays keep their order. */
export function sortKeys(tree) {
  if (tree.type === 'object') {
    const entries = tree.entries.map((entry) => ({ ...entry, value: sortKeys(entry.value) }));
    // Stable sort by code unit, so duplicates keep their relative order.
    entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return { type: 'object', entries };
  }
  if (tree.type === 'array') return { type: 'array', items: tree.items.map(sortKeys) };
  return tree;
}

/** Counts object keys, array items and nesting depth (a scalar has depth 0). */
export function jsonStats(tree) {
  let keys = 0;
  let items = 0;
  let depth = 0;
  const stack = [[tree, 0]];
  while (stack.length) {
    const [node, level] = stack.pop();
    if (node.type === 'object') {
      depth = Math.max(depth, level + 1);
      keys += node.entries.length;
      for (const entry of node.entries) stack.push([entry.value, level + 1]);
    } else if (node.type === 'array') {
      depth = Math.max(depth, level + 1);
      items += node.items.length;
      for (const item of node.items) stack.push([item, level + 1]);
    }
  }
  return { keys, items, depth, root: tree.type === 'literal' ? (tree.raw === 'null' ? 'null' : 'boolean') : tree.type };
}

/**
 * A small code frame for an error: the line before, the line itself and a caret under the column.
 * Long lines are cut to a window around the column.
 */
export function codeFrame(text, line, column, { width = 64 } = {}) {
  const lines = String(text).split(/\r?\n|\r/);
  const gutter = String(line).length;
  const cut = (content, start) => {
    const shown = content.slice(start, start + width).replace(/\t/g, ' ');
    return (start > 0 ? '…' : '') + shown + (content.length > start + width ? '…' : '');
  };
  const target = lines[line - 1] ?? '';
  const start = Math.max(0, Math.min(column - 1 - Math.floor(width / 2), target.length - width + 1));
  const out = [];
  if (line > 1) out.push(`${String(line - 1).padStart(gutter)} | ${cut(lines[line - 2], start)}`);
  out.push(`${String(line).padStart(gutter)} | ${cut(target, start)}`);
  const caretAt = column - 1 - start + (start > 0 ? 1 : 0);
  out.push(`${' '.repeat(gutter)} | ${' '.repeat(Math.max(0, caretAt))}^`);
  return out.join('\n');
}

/** Escapes any text as a JSON string literal, quotes included. */
export const escapeJsonString = (text) => JSON.stringify(String(text));

/**
 * Turns a JSON string literal back into text. The surrounding quotes are optional.
 * Throws JsonError with a position when an escape is broken.
 */
export function unescapeJsonString(text) {
  const src = String(text).trim();
  const quoted = src.length >= 2 && src[0] === '"' && src[src.length - 1] === '"';
  const literal = quoted ? src : `"${src}"`;
  // Offsets in `literal` are one ahead of `src` when we added the opening quote.
  const shift = quoted ? 0 : 1;
  try {
    const { tree } = parseJson(literal);
    return tree.value;
  } catch (error) {
    if (!(error instanceof JsonError)) throw error;
    if (/after the end/.test(error.message)) {
      // The string closed early: point at the unescaped quote that closed it.
      throw new JsonError('A double quote inside the text needs a backslash before it (\\").', Math.max(0, error.offset - 1 - shift), src);
    }
    throw new JsonError(error.message, Math.max(0, Math.min(src.length, error.offset - shift)), src);
  }
}

/** Formats JSON text in one go. options: indent, sort, jsonc. Returns { output, tree, duplicates }. */
export function formatJson(text, { indent = 2, sort = false, jsonc = false } = {}) {
  const { tree, duplicates } = parseJson(text, { jsonc });
  const shaped = sort ? sortKeys(tree) : tree;
  return { output: printJson(shaped, indent), tree, duplicates };
}

/** Builds the one-line status for valid JSON, e.g. "Valid JSON · 12 keys · depth 3 · 1.2 KB". */
export function describeJson(tree, size, formatSize = (n) => `${n} B`) {
  const stats = jsonStats(tree);
  const parts = ['Valid JSON'];
  if (stats.root === 'array') parts.push(`array of ${stats.items.toLocaleString('en')} item${stats.items === 1 ? '' : 's'}`);
  if (stats.root === 'object' || stats.keys) parts.push(`${stats.keys.toLocaleString('en')} key${stats.keys === 1 ? '' : 's'}`);
  if (stats.root !== 'object' && stats.root !== 'array') parts.push(`a single ${stats.root}`);
  parts.push(`depth ${stats.depth}`, formatSize(size));
  return parts.join(' · ');
}
