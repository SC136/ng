import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSize, collapse, diffLines, diffWords, formatStats, MAX_LINES, myers, splitLines, tokenize, unifiedDiff, withWordDiffs,
} from '../tools/diff/diff.js';

const types = (rows) => rows.map((row) => row.type).join(' ');

// Applies a list of ops to a and checks it rebuilds b, and returns the edit count.
function applyOps(a, b, ops) {
  const rebuilt = [];
  let edits = 0;
  for (const { op, a: i, b: j } of ops) {
    if (op === 'eq') {
      assert.equal(a[i], b[j]);
      rebuilt.push(b[j]);
    } else if (op === 'add') {
      rebuilt.push(b[j]);
      edits++;
    } else edits++;
  }
  assert.deepEqual(rebuilt, b);
  assert.equal(ops.filter((o) => o.op !== 'add').map((o) => a[o.a]).join(), a.join());
  return edits;
}

function lcsLength(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  }
  return dp[a.length][b.length];
}

test('splitLines handles line endings and the final newline', () => {
  assert.deepEqual(splitLines(''), { lines: [], eol: true });
  assert.deepEqual(splitLines('a\nb\n'), { lines: ['a', 'b'], eol: true });
  assert.deepEqual(splitLines('a\nb'), { lines: ['a', 'b'], eol: false });
  assert.deepEqual(splitLines('a\r\nb\r\n'), { lines: ['a', 'b'], eol: true });
  assert.deepEqual(splitLines('\n'), { lines: [''], eol: true });
});

test('myers finds a shortest edit script', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 4);
  for (let round = 0; round < 200; round++) {
    const a = Array.from({ length: rand() * 3 + rand() }, rand);
    const b = Array.from({ length: rand() * 3 + rand() }, rand);
    const edits = applyOps(a, b, myers(a, b));
    assert.equal(edits, a.length + b.length - 2 * lcsLength(a, b), `${a} → ${b}`);
  }
  const a = 'ABCABBA'.split('');
  const b = 'CBABAC'.split('');
  assert.equal(applyOps(a, b, myers(a, b)), 5);
});

test('identical texts', () => {
  const result = diffLines('a\nb\nc\n', 'a\nb\nc\n');
  assert.equal(result.identical, true);
  assert.equal(types(result.rows), 'eq eq eq');
  assert.equal(unifiedDiff('a\nb\n', 'a\nb\n'), '');
  assert.equal(diffLines('', '').rows.length, 0);
});

test('everything added or everything removed', () => {
  const added = diffLines('', 'x\ny\n');
  assert.equal(types(added.rows), 'add add');
  assert.deepEqual([added.added, added.removed], [2, 0]);
  assert.deepEqual(added.rows.map((row) => row.newNo), [1, 2]);
  const removed = diffLines('x\ny\n', '');
  assert.equal(types(removed.rows), 'del del');
  assert.deepEqual([removed.added, removed.removed], [0, 2]);
  assert.equal(unifiedDiff('', 'x\ny\n'), '--- original\n+++ changed\n@@ -0,0 +1,2 @@\n+x\n+y\n');
  assert.equal(unifiedDiff('x\n', ''), '--- original\n+++ changed\n@@ -1 +0,0 @@\n-x\n');
});

test('interleaved changes keep line numbers straight', () => {
  const result = diffLines('a\nb\nc\nd\ne\n', 'a\nB\nc\nd2\ne\nf\n');
  assert.equal(types(result.rows), 'eq del add eq del add eq add');
  assert.deepEqual(result.rows.map((row) => [row.oldNo, row.newNo]), [
    [1, 1], [2, null], [null, 2], [3, 3], [4, null], [null, 4], [5, 5], [null, 6],
  ]);
  assert.equal(formatStats(result), '+3 −2 lines');
  assert.equal(formatStats({ added: 1, removed: 0 }), '+1 −0 line');
});

test('deletions come before additions within a change', () => {
  assert.equal(types(diffLines('a\nx\ny\nb\n', 'a\np\nq\nb\n').rows), 'eq del del add add eq');
});

test('word-level highlights inside paired lines', () => {
  assert.deepEqual(tokenize('foo(bar, 2)'), ['foo', '(', 'bar', ',', ' ', '2', ')']);
  const words = diffWords('the quick brown fox', 'the quick red fox');
  assert.deepEqual(words.old, [{ text: 'the quick ', changed: false }, { text: 'brown', changed: true }, { text: ' fox', changed: false }]);
  assert.deepEqual(words.new, [{ text: 'the quick ', changed: false }, { text: 'red', changed: true }, { text: ' fox', changed: false }]);
  assert.equal(diffWords('completely different', 'xyz 123 nothing alike'), null);
  const rows = withWordDiffs(diffLines('one\nlet a = 1;\ntwo\n', 'one\nlet a = 2;\ntwo\n').rows);
  assert.equal(rows[1].type, 'del');
  assert.equal(rows[1].pair, 2);
  assert.equal(rows[2].pair, 1);
  assert.deepEqual(rows[2].words.filter((w) => w.changed).map((w) => w.text), ['2']);
});

test('ignore whitespace and ignore case', () => {
  assert.equal(diffLines('a  b\n', 'a b\n').identical, false);
  assert.equal(diffLines('a  b\n', 'a b\n', { ignoreWhitespace: true }).identical, true);
  assert.equal(diffLines('  indent\n', 'indent\n', { ignoreWhitespace: true }).identical, true);
  assert.equal(diffLines('Hello\n', 'hello\n').identical, false);
  assert.equal(diffLines('Hello\n', 'hello\n', { ignoreCase: true }).identical, true);
  const rows = diffLines('Keep\nX\n', 'keep\nY\n', { ignoreCase: true }).rows;
  assert.equal(types(rows), 'eq del add');
  assert.equal(rows[0].oldText, 'Keep');
  assert.equal(rows[0].newText, 'keep');
});

test('exact unified output for a small case', () => {
  const before = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n';
  const after = 'one\ntwo\nTHREE\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\n';
  assert.equal(unifiedDiff(before, after, { context: 2 }), [
    '--- original',
    '+++ changed',
    '@@ -1,5 +1,5 @@',
    ' one',
    ' two',
    '-three',
    '+THREE',
    ' four',
    ' five',
    '@@ -9,2 +9,3 @@',
    ' nine',
    ' ten',
    '+eleven',
    '',
  ].join('\n'));
  // With more context the two hunks merge into one.
  assert.match(unifiedDiff(before, after, { context: 4 }), /^@@ -1,10 \+1,11 @@$/m);
  assert.equal(unifiedDiff('a\nb\n', 'a\nc\n', { context: 0, oldLabel: 'x.txt', newLabel: 'y.txt' }), '--- x.txt\n+++ y.txt\n@@ -2 +2 @@\n-b\n+c\n');
});

test('trailing newline differences show up and are marked', () => {
  const result = diffLines('a\nb', 'a\nb\n');
  assert.equal(types(result.rows), 'eq del add');
  assert.equal(unifiedDiff('a\nb', 'a\nb\n'), '--- original\n+++ changed\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n');
  assert.equal(unifiedDiff('a\n', 'a\nb'), '--- original\n+++ changed\n@@ -1 +1,2 @@\n a\n+b\n\\ No newline at end of file\n');
  assert.equal(diffLines('a\nb', 'a\nb').identical, true);
  assert.equal(diffLines('a\nb', 'a\nb\n', { ignoreWhitespace: true }).identical, true);
  assert.equal(diffLines('a\r\nb\r\n', 'a\nb\n').identical, true);
});

test('collapse keeps context around changes and folds the rest', () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const changed = lines.slice();
  changed[9] = 'changed';
  const { rows } = diffLines(lines.join('\n'), changed.join('\n'));
  assert.deepEqual(collapse(rows, 2), [
    { kind: 'gap', start: 0, end: 7 },
    { kind: 'rows', start: 7, end: 13 },
    { kind: 'gap', start: 13, end: 21 },
  ]);
  assert.deepEqual(collapse(rows, Infinity), [{ kind: 'rows', start: 0, end: 21 }]);
  // A single hidden line isn't worth a fold.
  const short = diffLines('a\nb\nc\nd\n', 'a\nb\nc\nD\n').rows;
  assert.deepEqual(collapse(short, 2), [{ kind: 'rows', start: 0, end: 5 }]);
});

test('huge inputs are refused with a clear message', () => {
  const many = 'x\n'.repeat(MAX_LINES + 1);
  assert.throws(() => checkSize(many, ''), /original text has 50,001 lines/);
  assert.throws(() => diffLines('', many), /changed text has 50,001 lines/);
  const a = Array.from({ length: 4500 }, (_, i) => `a${i}`).join('\n');
  const b = Array.from({ length: 4500 }, (_, i) => `b${i}`).join('\n');
  assert.throws(() => diffLines(a, b), /differ in more than 3,000 lines/);
  // Large but similar inputs are fine thanks to the shared prefix and suffix.
  const big = Array.from({ length: 20000 }, (_, i) => `row ${i}`);
  const edited = big.slice();
  edited[10000] = 'edited';
  const result = diffLines(big.join('\n'), edited.join('\n'));
  assert.deepEqual([result.added, result.removed], [1, 1]);
});
