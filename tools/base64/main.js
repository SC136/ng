import { $, debounce, download, dropzone, formatBytes, load, save, segmented, setMsg, toast } from '/assets/ui.js';
import { bytesToBase64, decodeBase64Text, guessMime, hexPreview, toDataUrl, utf8Bytes } from './base64.js';

const plain = $('#plain');
const encoded = $('#encoded');
const status = $('#status');
const urlSafe = $('#urlsafe');
const noPad = $('#nopad');
const downloadButton = $('#download');

// The current content as bytes, whichever side it was typed on. Options re-encode from this.
let bytes = new Uint8Array();
let fileBytes = null;
let fileInfo = null;

const options = () => ({ urlSafe: urlSafe.checked, pad: !noPad.checked });

function updateCounts() {
  $('#plain-info').textContent = `${plain.value.length.toLocaleString()} characters · ${formatBytes(utf8Bytes(plain.value).length)}`;
  $('#encoded-info').textContent = `${encoded.value.replace(/\s+/g, '').length.toLocaleString()} characters`;
}

function encodeFromPlain() {
  bytes = utf8Bytes(plain.value);
  encoded.value = bytesToBase64(bytes, options());
  encoded.classList.remove('invalid');
  downloadButton.hidden = true;
  setMsg(status);
  updateCounts();
}

function decodeFromEncoded() {
  downloadButton.hidden = true;
  encoded.classList.remove('invalid');
  setMsg(status);
  if (!encoded.value.trim()) {
    bytes = new Uint8Array();
    plain.value = '';
    updateCounts();
    return;
  }
  try {
    const result = decodeBase64Text(encoded.value);
    bytes = result.bytes;
    if (result.text !== null) {
      plain.value = result.text;
      if (result.mime) setMsg(status, `Decoded a data URL of type ${result.mime}.`, 'ok');
    } else {
      plain.value = '';
      const kind = guessMime(bytes);
      const what = kind.label ? `a ${kind.label}` : 'binary data';
      setMsg(status, `This decodes to ${formatBytes(bytes.length)} of ${what}, not text. First bytes: ${hexPreview(bytes, 8)}. Download it to open it.`, 'warn');
      downloadButton.hidden = false;
    }
  } catch (error) {
    encoded.classList.add('invalid');
    setMsg(status, error.message, 'err');
  }
  updateCounts();
}

function showFile() {
  if (!fileBytes) return;
  $('#file-b64').value = bytesToBase64(fileBytes, options());
  // Data URLs always use standard, padded Base64.
  $('#file-dataurl').value = toDataUrl(fileBytes, fileInfo.type);
  const base64Length = $('#file-b64').value.length;
  $('#file-meta').replaceChildren(
    ...[
      ['Name', fileInfo.name],
      ['Type', fileInfo.type],
      ['Size', formatBytes(fileBytes.length)],
      ['Base64', `${base64Length.toLocaleString()} characters (${formatBytes(base64Length)})`],
    ].flatMap(([term, value]) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = term;
      dd.textContent = value;
      return [dt, dd];
    }),
  );
  $('#file-result').hidden = false;
}

plain.addEventListener('input', encodeFromPlain);
encoded.addEventListener('input', debounce(decodeFromEncoded, 120));

urlSafe.checked = load('base64.urlsafe', false);
noPad.checked = load('base64.nopad', false);
for (const box of [urlSafe, noPad]) {
  box.addEventListener('change', () => {
    save('base64.urlsafe', urlSafe.checked);
    save('base64.nopad', noPad.checked);
    // Leave invalid input alone so the user can fix it; otherwise re-encode the current bytes.
    if (!encoded.classList.contains('invalid') && bytes.length) {
      encoded.value = bytesToBase64(bytes, options());
      updateCounts();
    }
    showFile();
  });
}

downloadButton.addEventListener('click', () => {
  const kind = guessMime(bytes);
  download(new Blob([bytes], { type: kind.mime }), `decoded.${kind.ext}`);
});

$('#sample').addEventListener('click', () => {
  plain.value = 'Hello from ng.foo.ng. Ünïcödé and emoji work too: 🚀';
  encodeFromPlain();
  plain.focus();
});

$('#clear').addEventListener('click', () => {
  plain.value = '';
  encodeFromPlain();
  plain.focus();
});

segmented($('#mode'), (mode) => {
  $('#text-mode').hidden = mode !== 'text';
  $('#file-mode').hidden = mode !== 'file';
});

const MAX_FILE = 25 * 1024 * 1024;
dropzone($('#drop'), async ([file]) => {
  if (file.size > MAX_FILE) {
    toast(`That file is ${formatBytes(file.size)}. Files over 25 MB are too big to show as text here.`, 'err');
    return;
  }
  fileBytes = new Uint8Array(await file.arrayBuffer());
  fileInfo = { name: file.name, type: file.type || guessMime(fileBytes).mime };
  showFile();
});

updateCounts();
