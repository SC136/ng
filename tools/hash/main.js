import { $, debounce, dropzone, formatBytes, h, load, save, segmented, setMsg } from '/assets/ui.js';
import { digestAll, findMatches, formatDigest, hexToBytes } from './hash.js';

const textInput = $('#text');
const keyInput = $('#hmac-key');
const keyHex = $('#hmac-hex');
const compareInput = $('#compare');
const status = $('#status');
const progress = $('#progress');

const MAX_FILE = 1024 * 1024 * 1024;
const WARN_FILE = 200 * 1024 * 1024;
const SLOTS = { MD5: 'md5', 'SHA-1': 'sha1', 'SHA-256': 'sha256', 'SHA-384': 'sha384', 'SHA-512': 'sha512', CRC32: 'crc32' };
const encoder = new TextEncoder();

let file = null;
let results = null;
let jobId = 0;
let worker = null;
let useWorker = typeof Worker !== 'undefined';
let busy = false;

const format = segmented($('#format'), (value) => {
  save('hash.format', value);
  render();
});
format.value = ['hex', 'HEX', 'base64'].includes(load('hash.format', 'hex')) ? load('hash.format', 'hex') : 'hex';

const mode = segmented($('#mode'), (value) => {
  save('hash.mode', value);
  showMode();
  start();
});
mode.value = load('hash.mode', 'text') === 'file' ? 'file' : 'text';
keyHex.checked = load('hash.keyHex', false);

function showMode() {
  $('#text-mode').hidden = mode.value !== 'text';
  $('#file-mode').hidden = mode.value !== 'file';
}

// ---------- Rendering ----------
function render() {
  const hasResults = Boolean(results);
  $('#results-pane').hidden = !hasResults;
  $('#results-empty').hidden = hasResults || mode.value !== 'file';
  if (!hasResults) {
    setMsg($('#compare-status'));
    return;
  }
  const matches = findMatches(compareInput.value, results);
  const keyed = results[0].name.startsWith('HMAC-');
  for (const [base, slot] of Object.entries(SLOTS)) {
    const result = results.find((r) => r.name.replace(/^HMAC-/, '') === base);
    const row = document.getElementById(`row-${slot}`);
    const isMatch = Boolean(result && matches.includes(result.name));
    row.classList.toggle('match', isMatch);
    document.getElementById(`name-${slot}`).replaceChildren(
      result ? result.name : base,
      isMatch ? h('span', { class: 'badge ok', text: 'Match' }) : '',
    );
    const value = document.getElementById(`value-${slot}`);
    value.textContent = result ? formatDigest(result.bytes, format.value) : '';
    value.classList.toggle('muted', !result);
    if (!result && keyed) value.textContent = 'No keyed version';
    // The "No keyed version" note must not be copied as if it were a checksum.
    row.querySelector('button').disabled = !result;
  }
  if (!compareInput.value.trim()) {
    setMsg($('#compare-status'));
  } else if (matches.length) {
    setMsg($('#compare-status'), `Matches ${matches.join(' and ')}.`, 'ok');
  } else {
    setMsg($('#compare-status'), 'No match. The checksum doesn\'t equal any of the values below.', 'err');
  }
}

// ---------- Hashing ----------
function readKey() {
  setMsg($('#key-status'));
  keyInput.classList.remove('invalid');
  if (!keyInput.value) return null;
  try {
    return keyHex.checked ? hexToBytes(keyInput.value) : encoder.encode(keyInput.value);
  } catch (error) {
    keyInput.classList.add('invalid');
    setMsg($('#key-status'), error.message, 'err');
    return undefined;
  }
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', onWorkerMessage);
    worker.addEventListener('error', (event) => {
      event.preventDefault?.();
      // Module workers can fail to start in some browsers; fall back to the main thread.
      worker?.terminate();
      worker = null;
      useWorker = false;
      if (busy) start();
    });
  }
  return worker;
}

function finish(id, outcome) {
  if (id !== jobId) return;
  busy = false;
  $('#working').hidden = true;
  if (outcome.error) {
    results = null;
    setMsg(status, `Couldn't hash this: ${outcome.error}`, 'err');
  } else {
    results = outcome.results;
    const ms = Math.round(performance.now() - outcome.started);
    const keyed = results[0].name.startsWith('HMAC-');
    const what = file && mode.value === 'file' ? `${file.name} (${formatBytes(outcome.size)})` : `${formatBytes(outcome.size)} of text`;
    const tone = file && mode.value === 'file' && file.size > WARN_FILE ? 'warn' : 'ok';
    setMsg(status, `${keyed ? 'HMAC of' : 'Hashed'} ${what} in ${ms.toLocaleString()} ms.`, tone);
  }
  render();
}

let started = 0;
function onWorkerMessage({ data }) {
  if (data.id !== jobId) return;
  if (data.type === 'progress') {
    progress.value = data.fraction;
    $('#progress-label').textContent = `Hashing… ${Math.round(data.fraction * 100)}%`;
  } else if (data.type === 'done') {
    finish(data.id, { results: data.results, size: data.size, started });
  } else {
    finish(data.id, { error: data.message });
  }
}

async function hashOnMainThread(id, job) {
  try {
    const bytes = job.file ? new Uint8Array(await job.file.arrayBuffer()) : encoder.encode(job.text);
    const out = await digestAll(bytes, {
      hmacKey: job.hmacKey,
      onProgress: (fraction) => {
        if (id === jobId) progress.value = fraction;
      },
    });
    finish(id, { results: out, size: bytes.length, started });
  } catch (error) {
    finish(id, { error: error?.message || String(error) });
  }
}

function start() {
  const id = ++jobId;
  const hmacKey = readKey();
  if (hmacKey === undefined) {
    results = null;
    busy = false;
    $('#working').hidden = true;
    setMsg(status);
    render();
    return;
  }
  let job;
  if (mode.value === 'text') {
    $('#text-info').textContent = `${textInput.value.length.toLocaleString()} characters`;
    job = { text: textInput.value, hmacKey };
  } else {
    if (!file) {
      results = null;
      busy = false;
      $('#working').hidden = true;
      setMsg(status);
      render();
      return;
    }
    job = { file, hmacKey };
  }
  // A long file job still running would delay this one, so stop it.
  if (busy && worker) {
    worker.terminate();
    worker = null;
  }
  busy = true;
  started = performance.now();
  progress.value = 0;
  $('#progress-label').textContent = 'Hashing…';
  // Only show the progress bar for files; text is near instant.
  $('#working').hidden = !job.file;
  if (job.file) {
    setMsg(status, job.file.size > WARN_FILE ? `This file is ${formatBytes(job.file.size)}. Large files take a while and use a lot of memory.` : '', 'warn');
  }
  if (useWorker) {
    try {
      getWorker().postMessage({ id, ...job });
      return;
    } catch {
      useWorker = false;
    }
  }
  hashOnMainThread(id, job);
}

// ---------- Events ----------
const debouncedStart = debounce(start, 150);
textInput.addEventListener('input', debouncedStart);
keyInput.addEventListener('input', debouncedStart);
keyHex.addEventListener('change', () => {
  save('hash.keyHex', keyHex.checked);
  start();
});
compareInput.addEventListener('input', debounce(render, 100));

$('#sample').addEventListener('click', () => {
  textInput.value = 'The quick brown fox jumps over the lazy dog';
  start();
  textInput.focus();
});

$('#clear').addEventListener('click', () => {
  textInput.value = '';
  start();
  textInput.focus();
});

dropzone($('#drop'), ([picked]) => {
  if (picked.size > MAX_FILE) {
    setMsg(status, `That file is ${formatBytes(picked.size)}. Files over 1 GB are too big to hash in the browser.`, 'err');
    return;
  }
  file = picked;
  const meta = [['Name', file.name], ['Type', file.type || 'unknown'], ['Size', `${formatBytes(file.size)} (${file.size.toLocaleString()} bytes)`]];
  $('#file-meta').replaceChildren(...meta.flatMap(([term, value]) => [h('dt', { text: term }), h('dd', { text: value })]));
  $('#file-meta').hidden = false;
  start();
});

showMode();
start();
