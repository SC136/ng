import { $, debounce, download, formatBytes, h, hashParam, load, save, segmented, setMsg } from '/assets/ui.js';
import { MAX_TEXT, cellEdges, colorWarning, mailtoPayload, matrixToSvg, utf8BinaryString, wifiPayload } from './qr.js';

const status = $('#status');
const preview = $('#preview');
const payloadOut = $('#payload');
const info = $('#info');
const marginInput = $('#margin');
const pngSize = $('#png-size');
const fg = $('#fg');
const bg = $('#bg');
const svgButton = $('#dl-svg');
const pngButton = $('#dl-png');

const DEFAULT_FG = '#000000';
const DEFAULT_BG = '#ffffff';

// The last good code: { matrix, svg } or null.
let current = null;

const lib = typeof globalThis.qrcode === 'function' ? globalThis.qrcode : null;

const options = () => ({ margin: Number(marginInput.value), fg: fg.value, bg: bg.value });

function buildPayload() {
  if (kind.value === 'wifi') {
    return wifiPayload({ ssid: $('#ssid').value, password: $('#wifi-pass').value, auth: $('#wifi-auth').value, hidden: $('#wifi-hidden').checked });
  }
  if (kind.value === 'email') {
    return mailtoPayload({ to: $('#email-to').value, subject: $('#email-subject').value, body: $('#email-body').value });
  }
  return $('#text').value;
}

function setEmpty(text) {
  current = null;
  preview.replaceChildren(h('p', { class: 'empty', text }));
  info.textContent = '';
  svgButton.disabled = pngButton.disabled = true;
}

function render() {
  setMsg(status);
  if (!lib) {
    setEmpty('QR code unavailable.');
    payloadOut.textContent = '';
    setMsg(status, 'The QR code library didn\'t load. Check your connection or content blocker, then reload the page.', 'err');
    return;
  }
  let payload;
  try {
    payload = buildPayload();
  } catch (error) {
    payloadOut.textContent = '';
    setEmpty(error.message);
    return;
  }
  payloadOut.textContent = payload;
  if (!payload) {
    setEmpty('Type something to make a code.');
    return;
  }
  const binary = utf8BinaryString(payload);
  if (binary.length > MAX_TEXT) {
    setEmpty('Too long for a QR code.');
    setMsg(status, `This is ${formatBytes(binary.length)}. A QR code holds at most ${MAX_TEXT.toLocaleString()} bytes, and fewer at higher error correction.`, 'err');
    return;
  }
  let code;
  try {
    code = lib(0, ecc.value);
    code.addData(binary, 'Byte');
    code.make();
  } catch {
    setEmpty('Too long for a QR code.');
    setMsg(status, `Too much content for error correction ${ecc.value}. Shorten it or pick a lower level.`, 'err');
    return;
  }
  const size = code.getModuleCount();
  const matrix = { size, isDark: (row, col) => code.isDark(row, col) };
  const svg = matrixToSvg(matrix, options());
  current = { matrix, svg };
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  preview.replaceChildren(document.importNode(doc.documentElement, true));
  info.textContent = `Version ${(size - 17) / 4} · ${size} × ${size} modules · ${binary.length.toLocaleString()} bytes · level ${ecc.value}`;
  svgButton.disabled = pngButton.disabled = false;
}

const renderSoon = debounce(render, 150);

function checkColors() {
  setMsg($('#color-msg'), colorWarning(fg.value, bg.value), 'warn');
}

function persist() {
  save('qr.ecc', ecc.value);
  save('qr.margin', Number(marginInput.value));
  save('qr.pngSize', pngSize.value);
  save('qr.fg', fg.value);
  save('qr.bg', bg.value);
}

const kind = segmented($('#kind'), (value) => {
  $('#text-fields').hidden = value !== 'text';
  $('#wifi-fields').hidden = value !== 'wifi';
  $('#email-fields').hidden = value !== 'email';
  render();
});

const ecc = segmented($('#ecc'), () => {
  persist();
  render();
});

// Restore options.
const savedEcc = load('qr.ecc', 'M');
ecc.value = ['L', 'M', 'Q', 'H'].includes(savedEcc) ? savedEcc : 'M';
marginInput.value = String(Math.min(8, Math.max(0, Math.round(Number(load('qr.margin', 4))) || 0)));
$('#margin-value').textContent = marginInput.value;
const savedSize = String(load('qr.pngSize', '512'));
if ([...pngSize.options].some((option) => option.value === savedSize)) pngSize.value = savedSize;
const isHex = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
fg.value = isHex(load('qr.fg', DEFAULT_FG)) ? load('qr.fg', DEFAULT_FG) : DEFAULT_FG;
bg.value = isHex(load('qr.bg', DEFAULT_BG)) ? load('qr.bg', DEFAULT_BG) : DEFAULT_BG;

for (const id of ['#text', '#ssid', '#wifi-pass', '#email-to', '#email-subject', '#email-body']) {
  $(id).addEventListener('input', renderSoon);
}
$('#wifi-auth').addEventListener('change', () => {
  $('#wifi-pass-field').hidden = $('#wifi-auth').value === 'nopass';
  render();
});
$('#wifi-hidden').addEventListener('change', render);

marginInput.addEventListener('input', () => {
  $('#margin-value').textContent = marginInput.value;
  persist();
  render();
});
pngSize.addEventListener('change', persist);
for (const input of [fg, bg]) {
  input.addEventListener('input', () => {
    checkColors();
    persist();
    renderSoon();
  });
}
$('#reset-colors').addEventListener('click', () => {
  fg.value = DEFAULT_FG;
  bg.value = DEFAULT_BG;
  checkColors();
  persist();
  render();
});

svgButton.addEventListener('click', () => {
  if (current) download(current.svg, 'qr-code.svg', 'image/svg+xml');
});

pngButton.addEventListener('click', () => {
  if (!current) return;
  const { margin, fg: dark, bg: light } = options();
  const pixels = Number(pngSize.value);
  const total = current.matrix.size + margin * 2;
  const edges = cellEdges(total, pixels);
  const canvas = h('canvas', { width: pixels, height: pixels });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, pixels, pixels);
  ctx.fillStyle = dark;
  for (let row = 0; row < current.matrix.size; row++) {
    for (let col = 0; col < current.matrix.size; col++) {
      if (!current.matrix.isDark(row, col)) continue;
      const x = edges[col + margin];
      const y = edges[row + margin];
      ctx.fillRect(x, y, edges[col + margin + 1] - x, edges[row + margin + 1] - y);
    }
  }
  canvas.toBlob((blob) => {
    if (blob) download(blob, 'qr-code.png', 'image/png');
    else setMsg(status, 'Your browser couldn\'t make the PNG. Try the SVG instead.', 'err');
  }, 'image/png');
});

const initial = hashParam('text');
if (initial) $('#text').value = initial;
checkColors();
render();
