import { $, $$, debounce, download, dropzone, formatBytes, h, load, save, segmented, setMsg, toast } from '/assets/ui.js';
import {
  FORMATS, MAX_FILE_BYTES, MAX_PIXELS, fitSize, formatById, hasTransparency, makeZip, outputName, parseLimit, savings, uniqueNames,
} from './image.js';

const status = $('#status');
const quality = $('#quality');
const maxWidth = $('#max-width');
const maxHeight = $('#max-height');
const bgColor = $('#bg-color');

// Each item: { id, file, state: 'queued'|'working'|'done'|'error', result, error }.
// result: { blob, url, name, width, height, srcWidth, srcHeight, transparent }.
let items = [];
let nextId = 1;
// Bumped whenever options change, so stale encodes don't overwrite newer ones.
let generation = 0;
let supported = new Set(['png']);

const format = segmented($('#format'), (value) => {
  save('image.format', value);
  syncOptionUi();
  reprocessSoon();
});

function options() {
  const fmt = formatById(format.value) || formatById('png');
  return {
    format: fmt,
    quality: Number(quality.value) / 100,
    maxWidth: parseLimit(maxWidth.value),
    maxHeight: parseLimit(maxHeight.value),
    background: bgColor.value,
  };
}

function syncOptionUi() {
  const fmt = formatById(format.value);
  const lossless = fmt && !fmt.lossy;
  quality.disabled = lossless;
  $('#quality-hint').hidden = !lossless;
  $('#quality-value').value = String(quality.value);
  $('#bg-field').hidden = format.value !== 'jpeg';
}

// ---------- Encoding ----------

const canvasToBlob = (canvas, mime, q) => new Promise((resolve) => canvas.toBlob(resolve, mime, q));

async function probeFormats() {
  const canvas = h('canvas', { width: 2, height: 2 });
  canvas.getContext('2d').fillRect(0, 0, 1, 1);
  const found = new Set();
  for (const fmt of FORMATS) {
    try {
      const blob = await canvasToBlob(canvas, fmt.mime, 0.8);
      // Browsers fall back to PNG for types they can't encode.
      if (blob && blob.type === fmt.mime) found.add(fmt.id);
    } catch {}
  }
  return found;
}

// Downscales in halving steps first: one big drawImage jump looks jagged in some browsers.
function drawResized(source, srcWidth, srcHeight, width, height) {
  let current = source;
  let w = srcWidth;
  let hgt = srcHeight;
  while (w / 2 >= width && hgt / 2 >= height) {
    w = Math.round(w / 2);
    hgt = Math.round(hgt / 2);
    const step = h('canvas', { width: w, height: hgt });
    const ctx = step.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, w, hgt);
    current = step;
  }
  const out = h('canvas', { width, height });
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, width, height);
  return out;
}

function detectTransparency(bitmap) {
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const hgt = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = h('canvas', { width: w, height: hgt });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, hgt);
  return hasTransparency(ctx.getImageData(0, 0, w, hgt).data);
}

async function encode(file, opts) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error("This browser couldn't read that image. Try a JPEG, PNG, WebP, GIF or AVIF.");
  }
  try {
    if (bitmap.width * bitmap.height > MAX_PIXELS) {
      throw new Error(`At ${bitmap.width} × ${bitmap.height} this image is too large to process here (limit 100 megapixels).`);
    }
    const size = fitSize(bitmap.width, bitmap.height, { maxWidth: opts.maxWidth, maxHeight: opts.maxHeight });
    const transparent = detectTransparency(bitmap);
    let canvas = drawResized(bitmap, bitmap.width, bitmap.height, size.width, size.height);
    if (opts.format.id === 'jpeg' && transparent) {
      const flat = h('canvas', { width: size.width, height: size.height });
      const ctx = flat.getContext('2d');
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.drawImage(canvas, 0, 0);
      canvas = flat;
    }
    const blob = await canvasToBlob(canvas, opts.format.mime, opts.format.lossy ? opts.quality : undefined);
    if (!blob) throw new Error('Encoding failed. The image may be too large for this browser.');
    return {
      blob,
      name: outputName(file.name, opts.format.ext),
      width: size.width,
      height: size.height,
      srcWidth: bitmap.width,
      srcHeight: bitmap.height,
      transparent,
    };
  } finally {
    bitmap.close();
  }
}

function releaseResult(item) {
  if (item.result?.url) URL.revokeObjectURL(item.result.url);
  item.result = null;
}

async function processAll() {
  const run = ++generation;
  const opts = options();
  for (const item of items) {
    releaseResult(item);
    item.state = 'queued';
    item.error = null;
  }
  render();
  // One at a time keeps memory use bounded for big batches.
  for (const item of [...items]) {
    if (run !== generation) return;
    if (!items.includes(item)) continue;
    item.state = 'working';
    renderItem(item);
    try {
      const result = await encode(item.file, opts);
      if (run !== generation || !items.includes(item)) continue;
      result.url = URL.createObjectURL(result.blob);
      item.result = result;
      item.state = 'done';
    } catch (error) {
      if (run !== generation) return;
      item.state = 'error';
      item.error = error.message;
    }
    renderItem(item);
    renderTotals();
  }
}

const reprocessSoon = debounce(() => {
  if (items.length) processAll();
}, 250);

// ---------- Rendering ----------

function sizeLine(bytes, w, hgt) {
  return `${formatBytes(bytes)} · ${w} × ${hgt}`;
}

function itemNode(item) {
  const { file, result } = item;
  const thumb = result
    ? h('img', { class: 'thumb', src: result.url, alt: '', width: 72, height: 72 })
    : h('span', { class: 'thumb blank', 'aria-hidden': 'true', text: item.state === 'error' ? '!' : '…' });
  const meta = h('div', { class: 'meta' }, h('span', { class: 'name', text: file.name || 'Pasted image' }));
  const actions = h('div', { class: 'actions' });
  if (item.state === 'done') {
    const change = savings(file.size, result.blob.size);
    meta.append(
      h(
        'span',
        { class: 'sizes' },
        `${sizeLine(file.size, result.srcWidth, result.srcHeight)} → ${sizeLine(result.blob.size, result.width, result.height)}`,
      ),
      h(
        'span',
        { class: 'row' },
        h('span', { class: `badge ${change.tone}`, text: change.text }),
        change.smaller ? null : h('span', { class: 'hint', text: 'The output is bigger than the original. Try a lower quality or another format.' }),
        result.transparent && options().format.id === 'jpeg' ? h('span', { class: 'hint', text: 'Transparent areas were filled with the background color.' }) : null,
      ),
    );
    actions.append(
      h('button', { class: 'btn sm', type: 'button', text: 'Download', 'aria-label': `Download ${result.name}`, onclick: () => download(result.blob, result.name) }),
    );
  } else if (item.state === 'error') {
    meta.append(h('span', { class: 'err-text', text: item.error }));
  } else {
    meta.append(h('span', { class: 'muted', text: item.state === 'working' ? 'Converting…' : 'Waiting…' }));
  }
  actions.append(h('button', { class: 'btn sm ghost', type: 'button', text: 'Remove', 'aria-label': `Remove ${file.name || 'image'}`, onclick: () => removeItem(item) }));
  return h('li', { class: 'result', 'data-id': item.id }, thumb, meta, actions);
}

function renderItem(item) {
  const old = $(`[data-id="${item.id}"]`, $('#results'));
  if (old) old.replaceWith(itemNode(item));
}

function renderTotals() {
  const done = items.filter((item) => item.state === 'done');
  const before = done.reduce((sum, item) => sum + item.file.size, 0);
  const after = done.reduce((sum, item) => sum + item.result.blob.size, 0);
  $('#total-count').textContent = String(items.length);
  $('#total-before').textContent = done.length ? formatBytes(before) : '–';
  $('#total-after').textContent = done.length ? formatBytes(after) : '–';
  $('#total-savings').textContent = done.length ? savings(before, after).text : '–';
  $('#download-all').disabled = !done.length;
}

function render() {
  $('#results-pane').hidden = !items.length;
  $('#results').replaceChildren(...items.map(itemNode));
  renderTotals();
}

function removeItem(item) {
  releaseResult(item);
  items = items.filter((other) => other !== item);
  render();
}

// ---------- Input ----------

function addFiles(files) {
  setMsg(status);
  const images = files.filter((file) => file.type.startsWith('image/') || /\.(avif|heic|heif|jxl)$/i.test(file.name));
  const skipped = files.length - images.length;
  const tooBig = images.filter((file) => file.size > MAX_FILE_BYTES);
  const accepted = images.filter((file) => file.size <= MAX_FILE_BYTES);
  const notes = [];
  if (skipped) notes.push(`Skipped ${skipped} file${skipped === 1 ? '' : 's'} that ${skipped === 1 ? "isn't an image" : "aren't images"}.`);
  if (tooBig.length) notes.push(`Skipped ${tooBig.length} file${tooBig.length === 1 ? '' : 's'} over ${formatBytes(MAX_FILE_BYTES)}.`);
  if (notes.length) setMsg(status, notes.join(' '), 'warn');
  if (!accepted.length) return;
  for (const file of accepted) items.push({ id: nextId++, file, state: 'queued', result: null, error: null });
  processAll();
}

dropzone($('#drop'), addFiles, { accept: 'image/*', multiple: true });

document.addEventListener('paste', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  const files = Array.from(event.clipboardData?.files || []);
  if (!files.length) return;
  event.preventDefault();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  addFiles(files.map((file, i) => (file.name && file.name !== 'image.png'
    ? file
    : new File([file], `pasted-${stamp}${files.length > 1 ? `-${i + 1}` : ''}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: file.type }))));
});

$('#clear').addEventListener('click', () => {
  generation++;
  for (const item of items) releaseResult(item);
  items = [];
  setMsg(status);
  render();
});

$('#download-all').addEventListener('click', async () => {
  const done = items.filter((item) => item.state === 'done');
  if (!done.length) return;
  if (done.length === 1) {
    download(done[0].result.blob, done[0].result.name);
    return;
  }
  const names = uniqueNames(done.map((item) => item.result.name));
  const entries = await Promise.all(done.map(async (item, i) => ({ name: names[i], bytes: new Uint8Array(await item.result.blob.arrayBuffer()) })));
  download(new Blob([makeZip(entries)], { type: 'application/zip' }), 'images.zip');
  toast(`Zipped ${done.length} images`);
});

quality.addEventListener('input', () => {
  $('#quality-value').value = String(quality.value);
  save('image.quality', Number(quality.value));
  reprocessSoon();
});
for (const field of [maxWidth, maxHeight]) {
  field.addEventListener('input', () => {
    save('image.maxWidth', maxWidth.value);
    save('image.maxHeight', maxHeight.value);
    reprocessSoon();
  });
}
bgColor.addEventListener('input', () => {
  save('image.background', bgColor.value);
  if (format.value === 'jpeg') reprocessSoon();
});

window.addEventListener('pagehide', () => {
  for (const item of items) if (item.result?.url) URL.revokeObjectURL(item.result.url);
});

// ---------- Start ----------

quality.value = String(load('image.quality', 80));
maxWidth.value = load('image.maxWidth', '');
maxHeight.value = load('image.maxHeight', '');
bgColor.value = /^#[0-9a-f]{6}$/i.test(load('image.background', '')) ? load('image.background', '') : '#ffffff';
format.value = load('image.format', 'webp');
syncOptionUi();

probeFormats().then((found) => {
  supported = found;
  for (const button of $$('#format button[data-value]')) button.hidden = !supported.has(button.dataset.value);
  if (!supported.has(format.value)) {
    format.value = ['webp', 'jpeg', 'png'].find((id) => supported.has(id)) || 'png';
    syncOptionUi();
  }
  const missing = FORMATS.filter((fmt) => !supported.has(fmt.id)).map((fmt) => fmt.label);
  $('#format-hint').textContent = missing.length ? `This browser can't encode ${missing.join(' or ')}, so ${missing.length === 1 ? "it isn't" : "they aren't"} offered.` : '';
  reprocessSoon();
});
