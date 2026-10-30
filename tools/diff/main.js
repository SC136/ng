import { $, copyText, debounce, escapeHtml, load, save, segmented, setMsg, toast } from '/assets/ui.js';
import { collapse, diffLines, formatStats, splitLines, unifiedDiff, withWordDiffs } from './diff.js';

const oldInput = $('#old');
const newInput = $('#new');
const ignoreWs = $('#ignore-ws');
const ignoreCase = $('#ignore-case');
const contextSelect = $('#context');
const output = $('#output');
const status = $('#status');
const stats = $('#stats');

const MINUS = '−';

// Gaps the user has opened, by their first row index. Reset whenever the diff changes.
let expanded = new Set();
let current = null;

const options = () => ({ ignoreWhitespace: ignoreWs.checked, ignoreCase: ignoreCase.checked });
const contextLines = () => (contextSelect.value === 'all' ? Infinity : Number(contextSelect.value));

function lineInfo(text) {
  const count = splitLines(text).lines.length;
  return `${count.toLocaleString()} ${count === 1 ? 'line' : 'lines'}`;
}

function textHtml(row, side) {
  const text = side === 'old' ? row.oldText : row.newText;
  if (!row.words || row.type === 'eq') return escapeHtml(text);
  return row.words.map((piece) => (piece.changed ? `<span class="w">${escapeHtml(piece.text)}</span>` : escapeHtml(piece.text))).join('');
}

const marker = (type) => {
  if (type === 'del') return `<span class="mk" aria-hidden="true">${MINUS}</span><span class="sr-only">Removed: </span>`;
  if (type === 'add') return '<span class="mk" aria-hidden="true">+</span><span class="sr-only">Added: </span>';
  return '<span class="mk" aria-hidden="true"> </span>';
};

function codeCell(row, side) {
  if (!row) return '<td class="ln"></td><td class="code none"></td>';
  const no = side === 'old' ? row.oldNo : row.newNo;
  const cls = row.type === 'eq' ? '' : ` ${row.type}`;
  return `<td class="ln">${no}</td><td class="code${cls}">${marker(row.type)}${textHtml(row, side)}</td>`;
}

function gapRow(block, span) {
  const count = block.end - block.start;
  return `<tr class="gap"><td colspan="${span}"><button class="btn sm ghost" type="button" data-gap="${block.start}">Show ${count.toLocaleString()} unchanged lines</button></td></tr>`;
}

function splitRows(rows, start, end) {
  const html = [];
  let i = start;
  while (i < end) {
    const row = rows[i];
    if (row.type === 'eq') {
      html.push(`<tr>${codeCell(row, 'old')}${codeCell(row, 'new')}</tr>`);
      i++;
      continue;
    }
    // Line up a run of deletions against the additions that replace them.
    const dels = [];
    const adds = [];
    while (i < end && rows[i].type !== 'eq') {
      (rows[i].type === 'del' ? dels : adds).push(rows[i]);
      i++;
    }
    for (let p = 0; p < Math.max(dels.length, adds.length); p++) {
      html.push(`<tr>${codeCell(dels[p], 'old')}${codeCell(adds[p], 'new')}</tr>`);
    }
  }
  return html.join('');
}

function unifiedRows(rows, start, end) {
  const html = [];
  for (let i = start; i < end; i++) {
    const row = rows[i];
    const side = row.type === 'add' ? 'new' : 'old';
    const cls = row.type === 'eq' ? '' : ` ${row.type}`;
    html.push(`<tr><td class="ln">${row.oldNo ?? ''}</td><td class="ln">${row.newNo ?? ''}</td><td class="code${cls}">${marker(row.type)}${textHtml(row, side)}</td></tr>`);
  }
  return html.join('');
}

function render() {
  if (!current) {
    output.replaceChildren();
    return;
  }
  const { rows } = current;
  const split = view.value === 'split';
  const cols = split ? '<col class="ln"><col><col class="ln"><col>' : '<col class="ln"><col class="ln"><col>';
  const body = collapse(rows, contextLines()).map((block) => {
    if (block.kind === 'gap' && !expanded.has(block.start)) return gapRow(block, split ? 4 : 3);
    return split ? splitRows(rows, block.start, block.end) : unifiedRows(rows, block.start, block.end);
  });
  const caption = split ? 'Original on the left, changed on the right' : 'Unified view';
  output.innerHTML = `<table class="diff"><caption class="sr-only">${caption}</caption><colgroup>${cols}</colgroup><tbody>${body.join('')}</tbody></table>`;
}

function compare() {
  $('#old-info').textContent = lineInfo(oldInput.value);
  $('#new-info').textContent = lineInfo(newInput.value);
  expanded = new Set();
  current = null;
  stats.replaceChildren();
  setMsg(status);
  if (!oldInput.value && !newInput.value) {
    render();
    return;
  }
  try {
    const result = diffLines(oldInput.value, newInput.value, options());
    current = { ...result, rows: withWordDiffs(result.rows, options()) };
  } catch (error) {
    setMsg(status, error.message, 'err');
    render();
    return;
  }
  if (current.identical) {
    const ignoring = [ignoreWs.checked && 'whitespace', ignoreCase.checked && 'case'].filter(Boolean);
    setMsg(status, ignoring.length ? `No differences, ignoring ${ignoring.join(' and ')}.` : 'No differences. The texts are the same.', 'ok');
  }
  const [plus, minus] = formatStats(current).split(' ');
  const rest = formatStats(current).split(' ').slice(2).join(' ');
  stats.innerHTML = `<span class="ok-text">${escapeHtml(plus)}</span> <span class="err-text">${escapeHtml(minus)}</span> ${escapeHtml(rest)}`;
  render();
}

const view = segmented($('#view'), (value) => {
  save('diff.view', value);
  render();
});

oldInput.addEventListener('input', debounce(compare, 200));
newInput.addEventListener('input', debounce(compare, 200));

ignoreWs.checked = load('diff.ignoreWs', false);
ignoreCase.checked = load('diff.ignoreCase', false);
view.value = load('diff.view', 'split') === 'unified' ? 'unified' : 'split';
const savedContext = String(load('diff.context', '3'));
if ([...contextSelect.options].some((option) => option.value === savedContext)) contextSelect.value = savedContext;

for (const box of [ignoreWs, ignoreCase]) {
  box.addEventListener('change', () => {
    save('diff.ignoreWs', ignoreWs.checked);
    save('diff.ignoreCase', ignoreCase.checked);
    compare();
  });
}

contextSelect.addEventListener('change', () => {
  save('diff.context', contextSelect.value);
  expanded = new Set();
  render();
});

output.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-gap]');
  if (!button) return;
  expanded.add(Number(button.dataset.gap));
  render();
});

$('#copy-unified').addEventListener('click', () => {
  if (!oldInput.value && !newInput.value) {
    toast('Nothing to copy yet');
    return;
  }
  let text;
  try {
    text = unifiedDiff(oldInput.value, newInput.value, { ...options(), context: contextLines() });
  } catch (error) {
    setMsg(status, error.message, 'err');
    return;
  }
  if (!text) {
    toast('No differences to copy');
    return;
  }
  copyText(text);
});

$('#sample').addEventListener('click', () => {
  oldInput.value = [
    'function greet(name) {',
    '  const greeting = "Hello";',
    '  console.log(greeting + ", " + name);',
    '}',
    '',
    'greet("world");',
    'greet("there");',
    '',
  ].join('\n');
  newInput.value = [
    '// Says hello.',
    'function greet(name, punctuation = ".") {',
    '  const greeting = "Hello";',
    '  console.log(`${greeting}, ${name}${punctuation}`);',
    '}',
    '',
    'greet("world");',
    '',
  ].join('\n');
  compare();
});

$('#swap').addEventListener('click', () => {
  [oldInput.value, newInput.value] = [newInput.value, oldInput.value];
  compare();
});

$('#clear').addEventListener('click', () => {
  oldInput.value = '';
  newInput.value = '';
  compare();
  oldInput.focus();
});

compare();
