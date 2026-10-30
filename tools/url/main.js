import { $, debounce, h, load, save, segmented, setMsg } from '/assets/ui.js';
import { PART_NAMES, decodeUrl, encodeUrl, parseUrl, rebuildUrl } from './url.js';

// ---------- Encode / decode ----------
const plain = $('#plain');
const encoded = $('#encoded');
const status = $('#status');

const HINTS = {
  component: 'For one query value or path segment. Encodes everything except A–Z a–z 0–9 - _ . ! ~ * \' ( ).',
  full: 'For a whole URL. Leaves characters like : / ? # & = alone.',
  form: 'Like an HTML form: space becomes +, and only A–Z a–z 0–9 * - . _ stay as they are.',
};

const mode = segmented($('#mode'), (value) => {
  save('url.mode', value);
  $('#mode-hint').textContent = HINTS[value];
  // Re-encode from whichever side has content, preferring the text.
  if (plain.value || !encoded.value) encodeFromPlain();
  else decodeFromEncoded();
});
mode.value = load('url.mode', 'component');
if (!HINTS[mode.value]) mode.value = 'component';
$('#mode-hint').textContent = HINTS[mode.value];

function encodeFromPlain() {
  encoded.classList.remove('invalid');
  plain.classList.remove('invalid');
  setMsg(status);
  try {
    encoded.value = encodeUrl(plain.value, mode.value);
  } catch (error) {
    plain.classList.add('invalid');
    setMsg(status, error.message, 'err');
  }
}

function decodeFromEncoded() {
  encoded.classList.remove('invalid');
  plain.classList.remove('invalid');
  setMsg(status);
  try {
    plain.value = decodeUrl(encoded.value, mode.value);
  } catch (error) {
    encoded.classList.add('invalid');
    setMsg(status, error.message, 'err');
  }
}

plain.addEventListener('input', debounce(encodeFromPlain, 100));
encoded.addEventListener('input', debounce(decodeFromEncoded, 150));

$('#sample').addEventListener('click', () => {
  plain.value = mode.value === 'full' ? 'https://example.com/search?q=café & crème#top' : 'café & crème = 100% good/okay?';
  encodeFromPlain();
  plain.focus();
});

$('#clear').addEventListener('click', () => {
  plain.value = '';
  encoded.value = '';
  encodeFromPlain();
  plain.focus();
});

// ---------- URL parser ----------
const urlInput = $('#url-input');
const parseStatus = $('#parse-status');
const result = $('#parse-result');
const rows = $('#params-body');

const LABELS = { protocol: 'Protocol', username: 'Username', password: 'Password', host: 'Host', port: 'Port', path: 'Path', query: 'Query', hash: 'Hash', origin: 'Origin' };

function renderParts(parsed) {
  const items = PART_NAMES.filter((name) => name in parsed.parts).flatMap((name) => {
    const value = parsed.parts[name];
    return [h('dt', { text: LABELS[name] }), h('dd', { class: value ? '' : 'muted', text: value || '(none)' })];
  });
  $('#url-parts').replaceChildren(...items);
}

function paramRow(key = '', value = '') {
  const keyInput = h('input', { type: 'text', value: key, spellcheck: 'false', autocomplete: 'off' });
  const valueInput = h('input', { type: 'text', value, spellcheck: 'false', autocomplete: 'off' });
  keyInput.value = key;
  valueInput.value = value;
  const remove = h('button', { class: 'btn sm', type: 'button', text: 'Remove' });
  const tr = h('tr', {}, h('td', {}, keyInput), h('td', {}, valueInput), h('td', {}, remove));
  remove.addEventListener('click', () => {
    const next = tr.nextElementSibling || tr.previousElementSibling;
    tr.remove();
    relabel();
    rebuild();
    (next?.querySelector('input') || $('#add-param')).focus();
  });
  return tr;
}

function relabel() {
  [...rows.children].forEach((tr, i) => {
    const [keyInput, valueInput] = tr.querySelectorAll('input');
    keyInput.setAttribute('aria-label', `Key ${i + 1}`);
    valueInput.setAttribute('aria-label', `Value ${i + 1}`);
    tr.querySelector('button').setAttribute('aria-label', `Remove param ${i + 1}`);
  });
  $('#params-empty').hidden = rows.children.length > 0;
  $('#params').hidden = rows.children.length === 0;
}

const currentParams = () => [...rows.children].map((tr) => [...tr.querySelectorAll('input')].map((input) => input.value));

function rebuild() {
  urlInput.value = rebuildUrl(urlInput.value, currentParams());
  try {
    if (urlInput.value) renderParts(parseUrl(urlInput.value));
  } catch {}
}

rows.addEventListener('input', rebuild);

function parseFromInput() {
  urlInput.classList.remove('invalid');
  setMsg(parseStatus);
  if (!urlInput.value.trim()) {
    result.hidden = true;
    return;
  }
  let parsed;
  try {
    parsed = parseUrl(urlInput.value);
  } catch (error) {
    urlInput.classList.add('invalid');
    setMsg(parseStatus, error.message, 'err');
    result.hidden = true;
    return;
  }
  renderParts(parsed);
  rows.replaceChildren(...parsed.params.map(([key, value]) => paramRow(key, value)));
  relabel();
  if (parsed.kind === 'query') setMsg(parseStatus, 'Read as a query string on its own.', 'ok');
  result.hidden = false;
}

urlInput.addEventListener('input', debounce(parseFromInput, 150));

$('#add-param').addEventListener('click', () => {
  const tr = paramRow();
  rows.append(tr);
  relabel();
  tr.querySelector('input').focus();
});

$('#url-sample').addEventListener('click', () => {
  urlInput.value = 'https://user:secret@example.com:8080/docs/guide?lang=en&q=caf%C3%A9+cr%C3%A8me&page=2#install';
  parseFromInput();
  urlInput.focus();
});
