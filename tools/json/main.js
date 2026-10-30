import { $, debounce, download, formatBytes, h, load, save, segmented, setMsg } from '/assets/ui.js';
import { JsonError, codeFrame, describeJson, escapeJsonString, formatJson, unescapeJsonString } from './json.js';

const input = $('#input');
const output = $('#output');
const status = $('#status');
const sortBox = $('#sort');
const jsoncBox = $('#jsonc');
const downloadButton = $('#download');

const MAX_INPUT = 25 * 1024 * 1024;
const encoder = new TextEncoder();

const mode = segmented($('#mode'), (value) => {
  save('json.mode', value);
  syncControls();
  run();
});
const indent = segmented($('#indent'), (value) => {
  save('json.indent', value);
  run();
});

mode.value = load('json.mode', 'format');
if (!['format', 'minify', 'escape', 'unescape'].includes(mode.value)) mode.value = 'format';
indent.value = load('json.indent', '2');
if (!indent.value) indent.value = '2';
sortBox.checked = load('json.sort', false);
jsoncBox.checked = load('json.jsonc', false);

const TITLES = {
  format: ['JSON', 'Formatted', 'Paste JSON here…'],
  minify: ['JSON', 'Minified', 'Paste JSON here…'],
  escape: ['Text', 'JSON string', 'Type or paste any text to turn it into a JSON string…'],
  unescape: ['JSON string', 'Text', 'Paste a JSON string, with or without its quotes…'],
};

function syncControls() {
  const isJson = mode.value === 'format' || mode.value === 'minify';
  $('#indent').hidden = mode.value !== 'format';
  $('#sort-wrap').hidden = !isJson;
  $('#jsonc-wrap').hidden = !isJson;
  const [inTitle, outTitle, placeholder] = TITLES[mode.value];
  $('#input-title').textContent = inTitle;
  $('#output-title').textContent = outTitle;
  input.placeholder = placeholder;
  downloadButton.textContent = mode.value === 'unescape' ? 'Download .txt' : 'Download .json';
}

function updateCounts() {
  $('#input-info').textContent = `${input.value.length.toLocaleString()} characters · ${formatBytes(encoder.encode(input.value).length)}`;
  $('#output-info').textContent = output.value ? `${output.value.length.toLocaleString()} characters · ${formatBytes(encoder.encode(output.value).length)}` : '';
}

function showError(error) {
  input.classList.add('invalid');
  output.value = '';
  if (!(error instanceof JsonError)) {
    setMsg(status, error.message || 'Something went wrong.', 'err');
    return;
  }
  setMsg(status, `Line ${error.line}, column ${error.column}: ${error.message}`, 'err');
  status.append(
    h('pre', { 'aria-hidden': 'true', text: codeFrame(input.value, error.line, error.column) }),
    h('button', {
      class: 'btn sm', type: 'button', text: 'Show in input',
      onclick: () => {
        input.focus();
        input.setSelectionRange(error.offset, Math.min(error.offset + 1, input.value.length));
      },
    }),
  );
}

function run() {
  input.classList.remove('invalid');
  const text = input.value;
  if (text.length > MAX_INPUT) {
    output.value = '';
    setMsg(status, `This is ${formatBytes(text.length)}. Inputs over 25 MB are too big to handle here.`, 'err');
    updateCounts();
    return;
  }
  if (!text || (!text.trim() && mode.value !== 'escape')) {
    output.value = '';
    setMsg(status);
    updateCounts();
    return;
  }
  try {
    if (mode.value === 'escape') {
      output.value = escapeJsonString(text);
      setMsg(status, `Escaped as a JSON string · ${output.value.length.toLocaleString()} characters`, 'ok');
    } else if (mode.value === 'unescape') {
      output.value = unescapeJsonString(text);
      setMsg(status, `Unescaped · ${output.value.length.toLocaleString()} characters`, 'ok');
    } else {
      const size = mode.value === 'minify' ? 0 : indent.value === 'tab' ? '\t' : Number(indent.value);
      const result = formatJson(text, { indent: size, sort: sortBox.checked, jsonc: jsoncBox.checked });
      output.value = result.output;
      const line = describeJson(result.tree, encoder.encode(text).length, formatBytes);
      if (result.duplicates) {
        setMsg(status, `${line} · ${result.duplicates} duplicate key${result.duplicates === 1 ? '' : 's'}. Most parsers keep only the last one.`, 'warn');
      } else {
        setMsg(status, line, 'ok');
      }
    }
  } catch (error) {
    showError(error);
  }
  updateCounts();
}

const debounced = debounce(run, 150);
const slow = debounce(run, 500);
input.addEventListener('input', () => (input.value.length > 1_000_000 ? slow() : debounced()));

sortBox.addEventListener('change', () => {
  save('json.sort', sortBox.checked);
  run();
});
jsoncBox.addEventListener('change', () => {
  save('json.jsonc', jsoncBox.checked);
  run();
});

downloadButton.addEventListener('click', () => {
  if (!output.value) {
    setMsg(status, 'There is nothing to download yet.', 'warn');
    return;
  }
  const isText = mode.value === 'unescape';
  download(output.value, isText ? 'text.txt' : 'data.json', isText ? 'text/plain' : 'application/json');
});

const SAMPLES = {
  json: JSON.stringify({
    name: 'ng.foo.ng',
    tools: ['json', 'url', 'jwt', 'hash'],
    owner: { handle: 'ng', since: 2024, verified: true },
    note: 'Ünïcödé is fine',
    rating: null,
  }).replace('"since":2024', '"id":12345678901234567890,"since":2024'),
  escape: 'He said "hello"\nand left a tab\there.',
  unescape: '"He said \\"hello\\"\\nand left a tab\\there."',
};

$('#sample').addEventListener('click', () => {
  input.value = mode.value === 'escape' ? SAMPLES.escape : mode.value === 'unescape' ? SAMPLES.unescape : SAMPLES.json;
  run();
  input.focus();
});

$('#clear').addEventListener('click', () => {
  input.value = '';
  run();
  input.focus();
});

syncControls();
run();
