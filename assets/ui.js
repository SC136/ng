// DOM helpers shared by tool pages. Import what you use, e.g.
//   import { $, copyText, toast } from '/assets/ui.js';
// Logic modules (tools/<slug>/<slug>.js) must not import this file: it touches the DOM.

export { formatBytes } from './units.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Escapes text for use inside HTML markup or attribute values. */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Creates an element. Props: class, text, on<event> handlers, anything else becomes an attribute
 * (true → empty attribute, false/null → skipped). Children may be nodes, strings or arrays.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  el.append(...children.flat(Infinity).filter((child) => child != null && child !== false));
  return el;
}

export function debounce(fn, ms = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

let toastBox;
/** Shows a short message at the bottom of the screen. type: 'info' | 'err'. */
export function toast(message, type = 'info', ms = 2400) {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  const el = h('div', { class: type === 'err' ? 'toast err' : 'toast', text: message });
  toastBox.append(el);
  setTimeout(() => el.remove(), ms);
}

/** Copies text to the clipboard and confirms with a toast. Resolves to true on success. */
export async function copyText(text, { quiet = false } = {}) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const scratch = h('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;opacity:0' });
    scratch.value = text;
    document.body.append(scratch);
    scratch.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {}
    scratch.remove();
    if (!copied) {
      toast('Copy failed. Select the text and copy it yourself.', 'err');
      return false;
    }
  }
  if (!quiet) toast('Copied');
  return true;
}

const hasValue = (el) =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
  el instanceof HTMLSelectElement || el instanceof HTMLOutputElement;

// Any element with data-copy="#id" copies that element's value (or text);
// data-copy-text="…" copies the literal attribute value. No per-tool wiring needed.
if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest?.('[data-copy], [data-copy-text]');
    if (!trigger) return;
    let text = trigger.dataset.copyText;
    if (text == null) {
      const source = document.querySelector(trigger.dataset.copy);
      if (!source) return;
      text = hasValue(source) ? source.value : source.textContent;
    }
    if (!text) {
      toast('Nothing to copy yet');
      return;
    }
    copyText(text);
  });
}

/** Saves bytes, a Blob or a string as a file download. */
export function download(data, filename, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Reads a File as 'text', 'arrayBuffer' or 'dataURL'. */
export function readFile(file, as = 'arrayBuffer') {
  if (as === 'text') return file.text();
  if (as === 'arrayBuffer') return file.arrayBuffer();
  if (as === 'dataURL') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  throw new Error(`readFile: unknown mode "${as}"`);
}

/** Sets a .msg element's text and tone ('ok' | 'warn' | 'err' | ''). Empty text hides it. */
export function setMsg(el, text = '', tone = '') {
  el.textContent = text;
  el.className = tone ? `msg ${tone}` : 'msg';
}

/**
 * Wires a .seg group whose buttons carry data-value and aria-pressed.
 * onChange(value) runs when the user picks a different button.
 * Returns { value } — reading gives the pressed value, assigning presses a button without onChange.
 */
export function segmented(group, onChange) {
  const buttons = $$('button[data-value]', group);
  const press = (value) => {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.value === value));
  };
  group.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]');
    if (!button || !group.contains(button) || button.getAttribute('aria-pressed') === 'true') return;
    press(button.dataset.value);
    onChange?.(button.dataset.value);
  });
  return {
    get value() {
      return buttons.find((button) => button.getAttribute('aria-pressed') === 'true')?.dataset.value;
    },
    set value(value) {
      press(value);
    },
  };
}

/**
 * Makes an element a file drop target that also opens a file picker on click, Enter or Space.
 * onFiles receives an array of File objects (one unless multiple is true).
 */
export function dropzone(el, onFiles, { accept = '', multiple = false } = {}) {
  const input = h('input', { type: 'file', accept: accept || null, multiple, hidden: true, tabindex: '-1' });
  el.after(input);
  if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
  if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
  const deliver = (list) => {
    const files = Array.from(list || []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  el.addEventListener('click', () => input.click());
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    deliver(input.files);
    input.value = '';
  });
  el.addEventListener('dragover', (event) => {
    event.preventDefault();
    el.classList.add('over');
  });
  el.addEventListener('dragleave', (event) => {
    if (!el.contains(event.relatedTarget)) el.classList.remove('over');
  });
  el.addEventListener('drop', (event) => {
    event.preventDefault();
    el.classList.remove('over');
    deliver(event.dataTransfer?.files);
  });
  return { open: () => input.click() };
}

const STORE_PREFIX = 'ng:';
/** Reads a saved UI option. Never store what people type, only their settings. */
export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
  } catch {}
}

/** Reads a value from the page's #hash, e.g. /tools/qr/#text=hello → hashParam('text') === 'hello'. */
export function hashParam(name) {
  return new URLSearchParams(location.hash.slice(1)).get(name);
}
