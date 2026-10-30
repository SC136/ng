// Line and word diff logic. No DOM access, so Node tests can import it.

/** Inputs beyond these sizes are refused with a plain message instead of freezing the page. */
export const MAX_LINES = 50_000;
export const MAX_CHARS = 5_000_000;
/** Myers needs memory roughly proportional to the square of the number of changed lines. */
export const MAX_EDITS = 3_000;

/**
 * Splits text into lines. "\r\n" and "\r" count as line breaks. A final line break does not
 * start an extra empty line; `eol` says whether the text ended with one.
 */
export function splitLines(text) {
  const normal = String(text).replace(/\r\n?/g, '\n');
  if (normal === '') return { lines: [], eol: true };
  const eol = normal.endsWith('\n');
  const lines = (eol ? normal.slice(0, -1) : normal).split('\n');
  return { lines, eol };
}

/** Throws a plain-language Error if the inputs are too big to diff here. */
export function checkSize(oldText, newText) {
  const chars = String(oldText).length + String(newText).length;
  if (chars > MAX_CHARS) {
    throw new Error(`These texts are ${chars.toLocaleString('en-US')} characters together. The limit is ${MAX_CHARS.toLocaleString('en-US')}, so try a smaller part.`);
  }
  for (const [label, text] of [['original', oldText], ['changed', newText]]) {
    const count = splitLines(text).lines.length;
    if (count > MAX_LINES) {
      throw new Error(`The ${label} text has ${count.toLocaleString('en-US')} lines. The limit is ${MAX_LINES.toLocaleString('en-US')}.`);
    }
  }
}

/**
 * Myers' O(ND) diff of two arrays of comparable values (numbers or strings, compared with ===).
 * Returns ops in order: { op: 'eq' | 'del' | 'add', a, b } with indexes into each array.
 * Within each run of changes, deletions come before additions.
 */
export function myers(a, b, maxEdits = Infinity) {
  const n = a.length;
  const m = b.length;
  // Common prefix and suffix cost nothing and keep the search small.
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) start++;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops = [];
  for (let i = 0; i < start; i++) ops.push({ op: 'eq', a: i, b: i });
  ops.push(...middle(a, b, start, endA, start, endB, maxEdits));
  for (let i = 0; i < n - endA; i++) ops.push({ op: 'eq', a: endA + i, b: endB + i });
  return groupChanges(ops);
}

function middle(a, b, a0, a1, b0, b1, maxEdits) {
  const n = a1 - a0;
  const m = b1 - b0;
  if (!n && !m) return [];
  if (!n) return Array.from({ length: m }, (_, i) => ({ op: 'add', a: a0, b: b0 + i }));
  if (!m) return Array.from({ length: n }, (_, i) => ({ op: 'del', a: a0 + i, b: b0 }));
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= max; d++) {
    if (d > maxEdits) {
      throw new Error(`These texts differ in more than ${maxEdits.toLocaleString('en-US')} lines, which is too many to compare here.`);
    }
    // Snapshot of the furthest-reaching x for each diagonal after step d - 1.
    trace.push(v.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found !== -1) break;
  }
  const ops = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const snap = trace[d];
    const get = (k) => snap[k + d];
    const k = x - y;
    const prevK = k === -d || (k !== d && get(k - 1) < get(k + 1)) ? k + 1 : k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ op: 'eq', a: a0 + x, b: b0 + y });
    }
    if (x === prevX) {
      y--;
      ops.push({ op: 'add', a: a0 + x, b: b0 + y });
    } else {
      x--;
      ops.push({ op: 'del', a: a0 + x, b: b0 + y });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push({ op: 'eq', a: a0 + x, b: b0 + y });
  }
  return ops.reverse();
}

function groupChanges(ops) {
  const out = [];
  let dels = [];
  let adds = [];
  const flush = () => {
    out.push(...dels, ...adds);
    dels = [];
    adds = [];
  };
  for (const op of ops) {
    if (op.op === 'eq') {
      flush();
      out.push(op);
    } else (op.op === 'del' ? dels : adds).push(op);
  }
  flush();
  return out;
}

function lineKey({ ignoreWhitespace = false, ignoreCase = false } = {}) {
  return (line) => {
    let key = line;
    if (ignoreWhitespace) key = key.replace(/\s+/g, '');
    if (ignoreCase) key = key.toLowerCase();
    return key;
  };
}

/**
 * Diffs two texts line by line.
 * Options: ignoreWhitespace (all whitespace, like `diff -w`), ignoreCase.
 * Returns { rows, added, removed, identical, oldEol, newEol }. Each row is
 * { type: 'eq' | 'del' | 'add', oldNo, newNo, oldText, newText } with 1-based line numbers
 * (null on the side a line doesn't exist).
 */
export function diffLines(oldText, newText, options = {}) {
  checkSize(oldText, newText);
  const before = splitLines(oldText);
  const after = splitLines(newText);
  const key = lineKey(options);
  // A missing final line break is a change on the last line, unless whitespace is ignored.
  const NOEOL = '\u0000no newline';
  const ids = new Map();
  const toIds = ({ lines, eol }) => lines.map((line, i) => {
    let k = key(line);
    if (!eol && i === lines.length - 1 && !options.ignoreWhitespace) k += NOEOL;
    let id = ids.get(k);
    if (id === undefined) {
      id = ids.size;
      ids.set(k, id);
    }
    return id;
  });
  const ops = myers(toIds(before), toIds(after), MAX_EDITS);
  let added = 0;
  let removed = 0;
  const rows = ops.map(({ op, a, b }) => {
    if (op === 'eq') return { type: 'eq', oldNo: a + 1, newNo: b + 1, oldText: before.lines[a], newText: after.lines[b] };
    if (op === 'del') {
      removed++;
      return { type: 'del', oldNo: a + 1, newNo: null, oldText: before.lines[a], newText: null };
    }
    added++;
    return { type: 'add', oldNo: null, newNo: b + 1, oldText: null, newText: after.lines[b] };
  });
  return { rows, added, removed, identical: !added && !removed, oldEol: before.eol, newEol: after.eol };
}

/** Splits a line into word, space and punctuation tokens for the word diff. */
export const tokenize = (line) => line.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [];

/**
 * Word-level diff of one changed line pair. Returns { old, new } arrays of { text, changed }
 * (adjacent pieces merged), or null when the lines have too little in common for highlighting
 * to help.
 */
export function diffWords(oldLine, newLine, options = {}) {
  const a = tokenize(oldLine);
  const b = tokenize(newLine);
  const key = lineKey(options);
  const norm = (token) => (/^\s+$/.test(token) ? (options.ignoreWhitespace ? '' : token) : key(token));
  const ops = myers(a.map(norm), b.map(norm));
  const left = [];
  const right = [];
  let common = 0;
  const push = (list, text, changed) => {
    const last = list[list.length - 1];
    if (last && last.changed === changed) last.text += text;
    else list.push({ text, changed });
  };
  for (const { op, a: i, b: j } of ops) {
    if (op === 'eq') {
      common += a[i].length;
      push(left, a[i], false);
      push(right, b[j], false);
    } else if (op === 'del') push(left, a[i], true);
    else push(right, b[j], true);
  }
  const longest = Math.max(oldLine.length, newLine.length);
  if (longest && common / longest < 0.3) return null;
  return { old: left, new: right };
}

/**
 * Pairs deleted and added rows inside each change run (first deletion with first addition, …)
 * and attaches word diffs. Returns a copy of rows where paired rows carry `words`
 * ({ text, changed }[]) and `pair` (index of the other row).
 */
export function withWordDiffs(rows, options = {}) {
  const out = rows.map((row) => ({ ...row }));
  let i = 0;
  while (i < out.length) {
    if (out[i].type === 'eq') {
      i++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (i < out.length && out[i].type !== 'eq') {
      (out[i].type === 'del' ? dels : adds).push(i);
      i++;
    }
    for (let p = 0; p < Math.min(dels.length, adds.length); p++) {
      const del = out[dels[p]];
      const add = out[adds[p]];
      // Very long lines would make the word diff slow; leave them whole.
      if (del.oldText.length + add.newText.length > 20_000) continue;
      const words = diffWords(del.oldText, add.newText, options);
      if (!words) continue;
      del.words = words.old;
      add.words = words.new;
      del.pair = adds[p];
      add.pair = dels[p];
    }
  }
  return out;
}

/**
 * Groups rows into visible blocks and collapsed gaps of unchanged lines. Keeps `context`
 * unchanged lines around each change (Infinity keeps everything).
 * Returns [{ kind: 'rows', start, end } | { kind: 'gap', start, end }] with row index ranges
 * (end exclusive). Gaps shorter than 2 lines are shown instead.
 */
export function collapse(rows, context = 3) {
  if (!Number.isFinite(context)) return rows.length ? [{ kind: 'rows', start: 0, end: rows.length }] : [];
  const keep = new Uint8Array(rows.length);
  rows.forEach((row, i) => {
    if (row.type === 'eq') return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep[j] = 1;
  });
  const blocks = [];
  let i = 0;
  while (i < rows.length) {
    let j = i;
    const shown = keep[i];
    while (j < rows.length && keep[j] === shown) j++;
    const kind = shown || j - i < 2 ? 'rows' : 'gap';
    const last = blocks[blocks.length - 1];
    if (kind === 'rows' && last?.kind === 'rows') last.end = j;
    else blocks.push({ kind, start: i, end: j });
    i = j;
  }
  return blocks;
}

/**
 * Builds a unified diff (as `diff -u` prints it) that `patch` and `git apply` accept.
 * Options: context (default 3), oldLabel, newLabel, plus the diffLines options.
 * Returns '' when the texts are the same.
 */
export function unifiedDiff(oldText, newText, { context = 3, oldLabel = 'original', newLabel = 'changed', ...options } = {}) {
  const result = diffLines(oldText, newText, options);
  if (result.identical) return '';
  const { rows } = result;
  const oldCount = rows.filter((row) => row.oldNo != null).length;
  const newCount = rows.filter((row) => row.newNo != null).length;
  const ctx = Number.isFinite(context) ? Math.max(0, context) : rows.length;
  const out = [`--- ${oldLabel}`, `+++ ${newLabel}`];
  // Hunk ranges: changes closer than 2 × context lines share a hunk.
  const changed = rows.map((row, i) => (row.type === 'eq' ? -1 : i)).filter((i) => i >= 0);
  const hunks = [];
  for (const i of changed) {
    const from = Math.max(0, i - ctx);
    const to = Math.min(rows.length, i + ctx + 1);
    const last = hunks[hunks.length - 1];
    if (last && from <= last.end) last.end = Math.max(last.end, to);
    else hunks.push({ start: from, end: to });
  }
  const range = (first, count) => {
    // An empty range names the line before it (0 at the start of the file).
    const start = count === 0 ? first - 1 : first;
    return count === 1 ? `${start}` : `${start},${count}`;
  };
  for (const { start, end } of hunks) {
    const slice = rows.slice(start, end);
    let oldStart = 0;
    let newStart = 0;
    // The first line number on each side: from the slice, or one past the previous line.
    const firstOld = slice.find((row) => row.oldNo != null);
    const firstNew = slice.find((row) => row.newNo != null);
    const prevOld = rows.slice(0, start).filter((row) => row.oldNo != null).length;
    const prevNew = rows.slice(0, start).filter((row) => row.newNo != null).length;
    oldStart = firstOld ? firstOld.oldNo : prevOld + 1;
    newStart = firstNew ? firstNew.newNo : prevNew + 1;
    const oldLen = slice.filter((row) => row.oldNo != null).length;
    const newLen = slice.filter((row) => row.newNo != null).length;
    out.push(`@@ -${range(oldStart, oldLen)} +${range(newStart, newLen)} @@`);
    for (const row of slice) {
      if (row.type === 'eq') {
        out.push(` ${row.oldText}`);
        // Context lines are the same on both sides; mark if either side lacks the final newline.
        if ((row.oldNo === oldCount && !result.oldEol) || (row.newNo === newCount && !result.newEol)) {
          out.push('\\ No newline at end of file');
        }
      } else if (row.type === 'del') {
        out.push(`-${row.oldText}`);
        if (row.oldNo === oldCount && !result.oldEol) out.push('\\ No newline at end of file');
      } else {
        out.push(`+${row.newText}`);
        if (row.newNo === newCount && !result.newEol) out.push('\\ No newline at end of file');
      }
    }
  }
  return `${out.join('\n')}\n`;
}

/** "+12 −4 lines" style summary. */
export function formatStats({ added, removed }) {
  const plural = added + removed === 1 ? 'line' : 'lines';
  return `+${added.toLocaleString('en-US')} −${removed.toLocaleString('en-US')} ${plural}`;
}
