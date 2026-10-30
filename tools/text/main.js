import { $, $$, debounce, load, save, setMsg } from '/assets/ui.js';
import { formatReadingTime, stats, transform } from './text.js';

const input = $('#input');
const output = $('#output');
const status = $('#status');
const outputInfo = $('#output-info');
const dedupeCi = $('#dedupe-ci');

const MAX_CHARS = 1_000_000;
let lastOp = null;

function showStats() {
  const text = input.value;
  if (text.length > MAX_CHARS) {
    setMsg(status, `The input is ${text.length.toLocaleString()} characters. Counts and transforms stop at ${MAX_CHARS.toLocaleString()}.`, 'err');
    return;
  }
  if (status.classList.contains('err')) setMsg(status);
  const s = stats(text);
  $('#st-chars').textContent = s.characters.toLocaleString();
  $('#st-nospace').textContent = s.charactersNoSpaces.toLocaleString();
  $('#st-words').textContent = s.words.toLocaleString();
  $('#st-lines').textContent = s.lines.toLocaleString();
  $('#st-paras').textContent = s.paragraphs.toLocaleString();
  $('#st-bytes').textContent = s.bytes.toLocaleString();
  $('#st-read').textContent = formatReadingTime(s.readingMinutes, s.words);
}

function apply(button) {
  setMsg(status);
  if (!input.value) {
    setMsg(status, 'Type or paste some text first.', 'warn');
    return;
  }
  if (input.value.length > MAX_CHARS) {
    setMsg(status, `The input is too long. The limit is ${MAX_CHARS.toLocaleString()} characters.`, 'err');
    return;
  }
  try {
    output.value = transform(input.value, button.dataset.op, { ignoreCase: dedupeCi.checked });
  } catch (error) {
    setMsg(status, error.message, 'err');
    return;
  }
  lastOp = button;
  const changed = output.value === input.value ? 'no change' : `${output.value.length.toLocaleString()} characters`;
  outputInfo.textContent = `${button.textContent.trim()}: ${changed}`;
}

for (const button of $$('[data-op]')) button.addEventListener('click', () => apply(button));

input.addEventListener('input', debounce(showStats, 150));

dedupeCi.checked = load('text.dedupeIgnoreCase', false);
dedupeCi.addEventListener('change', () => {
  save('text.dedupeIgnoreCase', dedupeCi.checked);
  if (lastOp?.dataset.op === 'dedupe') apply(lastOp);
});

$('#use').addEventListener('click', () => {
  if (!output.value) {
    setMsg(status, 'There is no output to use yet.', 'warn');
    return;
  }
  input.value = output.value;
  output.value = '';
  outputInfo.textContent = 'Output moved to the input.';
  lastOp = null;
  showStats();
  input.focus();
});

$('#sample').addEventListener('click', () => {
  input.value = [
    'XMLHttpRequest',
    'Héllo Wörld!',
    'file10.txt',
    'file2.txt',
    '  the quick   brown fox  ',
    'file2.txt',
    '',
    'Family: 👨‍👩‍👧‍👦',
  ].join('\n');
  showStats();
  input.focus();
});

$('#clear').addEventListener('click', () => {
  input.value = '';
  output.value = '';
  outputInfo.textContent = '';
  lastOp = null;
  setMsg(status);
  showStats();
  input.focus();
});

showStats();
