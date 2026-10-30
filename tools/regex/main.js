import { $, $$, debounce, escapeHtml, h, load, save, setMsg } from '/assets/ui.js';
import { compile, segments, supportedFlags, toLiteral } from './regex.js';

const patternInput = $('#pattern');
const textInput = $('#text');
const replacementInput = $('#replacement');
const patternMsg = $('#pattern-msg');
const runMsg = $('#run-msg');
const highlight = $('#highlight');
const count = $('#count');
const matchesBox = $('#matches');
const preview = $('#preview');
const literal = $('#literal');
const flagBoxes = $$('#flags input[data-flag]');

const MATCH_LIMIT = 1000;
const MAX_TEXT = 1_000_000;
const TIMEOUT_MS = 1000;
// Flag order as RegExp.prototype.flags prints it.
const FLAG_ORDER = 'dgimsuvy';

let worker = null;
let busy = false;
let jobId = 0;
let timer = 0;

const flags = () => flagBoxes.filter((box) => box.checked).map((box) => box.dataset.flag)
  .sort((a, b) => FLAG_ORDER.indexOf(a) - FLAG_ORDER.indexOf(b)).join('');

function startWorker() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', onResult);
  worker.addEventListener('error', (event) => {
    event.preventDefault();
    stopWorker();
    setMsg(runMsg, 'The background matcher could not start in this browser.', 'err');
  });
}

function stopWorker() {
  clearTimeout(timer);
  worker?.terminate();
  worker = null;
  busy = false;
}

function clearResults(message = 'Matches and their groups appear here.') {
  highlight.textContent = textInput.value;
  count.textContent = 'No matches';
  count.className = 'badge';
  matchesBox.replaceChildren(h('p', { class: 'empty', text: message }));
  preview.textContent = '';
}

function update() {
  const pattern = patternInput.value;
  const text = textInput.value;
  const flagText = flags();
  $('#flags-shown').textContent = flagText;
  $('#text-info').textContent = `${text.length.toLocaleString()} characters`;
  setMsg(runMsg);
  patternInput.classList.remove('invalid');
  setMsg(patternMsg);

  // Compiling is quick and can't hang, so errors show without waiting for the worker.
  try {
    compile(pattern, flagText);
    literal.textContent = toLiteral(pattern, flagText);
  } catch (error) {
    stopWorker();
    patternInput.classList.add('invalid');
    setMsg(patternMsg, error.message, 'err');
    literal.textContent = '';
    clearResults('Fix the pattern to see matches.');
    return;
  }
  if (text.length > MAX_TEXT) {
    stopWorker();
    setMsg(runMsg, `The test text is ${text.length.toLocaleString()} characters. The limit is ${MAX_TEXT.toLocaleString()}.`, 'err');
    clearResults();
    return;
  }
  if (!pattern) {
    stopWorker();
    clearResults('Type a pattern to see matches.');
    return;
  }

  // A job still running means the last pattern is slow: start over with a fresh worker.
  if (busy) stopWorker();
  if (!worker) startWorker();
  const id = ++jobId;
  busy = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (id !== jobId) return;
    stopWorker();
    clearResults('Stopped. No results.');
    setMsg(runMsg, `Matching took longer than ${TIMEOUT_MS / 1000} second, so it was stopped. The pattern may backtrack catastrophically, for example with nested quantifiers like (a+)+. Try a more specific pattern or shorter text.`, 'err');
  }, TIMEOUT_MS);
  worker.postMessage({ id, pattern, flags: flagText, text, replacement: replacementInput.value, limit: MATCH_LIMIT });
}

function onResult({ data }) {
  if (data.id !== jobId) return;
  clearTimeout(timer);
  busy = false;
  if (!data.ok) {
    setMsg(runMsg, data.error, 'err');
    clearResults();
    return;
  }
  const text = textInput.value;
  renderHighlight(text, data.matches);
  renderTable(data.matches, data.groupCount, data.names);
  preview.textContent = data.preview ?? '';
  const n = data.matches.length;
  count.textContent = n === 0 ? 'No matches' : `${data.truncated ? 'First ' : ''}${n.toLocaleString()} ${n === 1 ? 'match' : 'matches'}`;
  count.className = n ? 'badge ok' : 'badge';
  if (data.truncated) setMsg(runMsg, `Showing the first ${MATCH_LIMIT.toLocaleString()} matches. The replacement preview covers all of them.`, 'warn');
}

function renderHighlight(text, matches) {
  highlight.innerHTML = segments(text, matches).map((piece) => {
    if (piece.match === null) return escapeHtml(piece.text);
    const label = `Match ${piece.match + 1} at ${matches[piece.match].index}`;
    if (piece.empty) return `<span class="zw" role="img" aria-label="Empty ${label.toLowerCase()}" title="Empty ${label.toLowerCase()}"></span>`;
    return `<mark class="${piece.match % 2 ? 'alt' : ''}" title="${escapeHtml(label)}">${escapeHtml(piece.text)}</mark>`;
  }).join('');
}

const cell = (value) => {
  if (value === undefined) return h('td', { class: 'none', title: 'This group did not take part in the match' }, '–');
  if (value === '') return h('td', { class: 'none' }, '(empty)');
  return h('td', {}, value);
};

function renderTable(matches, groupCount, names) {
  if (!matches.length) {
    matchesBox.replaceChildren(h('p', { class: 'empty', text: 'No matches.' }));
    return;
  }
  const groupHeads = Array.from({ length: groupCount }, (_, i) => h('th', { scope: 'col' }, names[i] ? `$${i + 1} ${names[i]}` : `$${i + 1}`));
  const head = h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Index'), h('th', { scope: 'col' }, 'Match'), groupHeads));
  const body = h('tbody', {}, matches.map((m, i) => h('tr', {},
    h('td', {}, String(i + 1)),
    h('td', {}, `${m.index}–${m.end}`),
    cell(m.text),
    Array.from({ length: groupCount }, (_, g) => cell(m.groups[g]?.value)),
  )));
  matchesBox.replaceChildren(h('table', { class: 'data' }, head, body));
}

const run = debounce(update, 150);
patternInput.addEventListener('input', run);
textInput.addEventListener('input', run);
replacementInput.addEventListener('input', run);

const available = supportedFlags();
const savedFlags = String(load('regex.flags', 'g'));
for (const box of flagBoxes) {
  if (!available.includes(box.dataset.flag)) {
    box.closest('label').hidden = true;
    continue;
  }
  box.checked = savedFlags.includes(box.dataset.flag);
  box.addEventListener('change', () => {
    // u and v can't be combined; picking one clears the other.
    if (box.checked && (box.dataset.flag === 'u' || box.dataset.flag === 'v')) {
      const other = $(box.dataset.flag === 'u' ? '#flag-v' : '#flag-u');
      other.checked = false;
    }
    save('regex.flags', flags());
    update();
  });
}

$('#sample').addEventListener('click', () => {
  patternInput.value = '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+(?:\\.[\\w-]+)+)';
  textInput.value = 'Write to ada@example.com or grace.hopper@navy.mil.\nNot an address: @handle, user@localhost';
  replacementInput.value = '$<user> at $<domain>';
  if (!$('#flag-g').checked) $('#flag-g').checked = true;
  save('regex.flags', flags());
  update();
});

$('#clear').addEventListener('click', () => {
  textInput.value = '';
  update();
  textInput.focus();
});

update();
