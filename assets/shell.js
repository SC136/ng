// Renders the shared header and footer, the theme toggle and the command palette ("/" or Ctrl+K).
import { TOOLS, searchTools, toolUrl } from './tools.js';

const REPO = 'https://github.com/SC136/ng';

const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>',
};

const escape = (text) => String(text).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const path = location.pathname;
const section = path.startsWith('/tools/links') ? 'links'
  : path.startsWith('/tools') ? 'tools'
  : path.startsWith('/lab') ? 'lab' : '';
const current = (name) => (section === name ? ' aria-current="page"' : '');

function renderHeader() {
  const slot = document.querySelector('[data-shell="header"]');
  if (!slot) return;
  slot.outerHTML = `
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/" aria-label="ng.foo.ng home"><span class="brand-mark" aria-hidden="true">ng</span><span class="brand-name">ng.foo.ng</span></a>
    <nav class="nav" aria-label="Main">
      <a href="/tools/"${current('tools')}>Tools</a>
      <a href="/lab/"${current('lab')}>Lab</a>
      <a href="/tools/links/"${current('links')}>Links</a>
    </nav>
    <button class="btn ghost search-btn" type="button" data-palette aria-label="Search tools" aria-keyshortcuts="/ Control+K">${ICONS.search}<span>Search</span><kbd class="kbd">/</kbd></button>
    <button class="btn ghost icon" type="button" data-theme-toggle></button>
  </div>
</header>`;
}

function renderFooter() {
  const slot = document.querySelector('[data-shell="footer"]');
  if (!slot) return;
  slot.outerHTML = `
<footer class="site-footer">
  <div class="wrap">
    <span>Everything here runs in your browser. Nothing you type or drop gets uploaded.</span>
    <span class="spacer"></span>
    <a href="https://swar.is-a.dev">made by Swar</a>
    <a href="${REPO}">source</a>
  </div>
</footer>`;
}

// ---------- Theme ----------
const prefersDark = matchMedia('(prefers-color-scheme: dark)');
const effectiveTheme = () => document.documentElement.dataset.theme || (prefersDark.matches ? 'dark' : 'light');

function paintThemeButton(button) {
  const dark = effectiveTheme() === 'dark';
  button.innerHTML = dark ? ICONS.sun : ICONS.moon;
  button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  button.title = button.getAttribute('aria-label');
}

function wireTheme() {
  const button = document.querySelector('[data-theme-toggle]');
  if (!button) return;
  paintThemeButton(button);
  button.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('ng-theme', next);
    } catch {}
    paintThemeButton(button);
    // Pages that draw with canvas can listen for this and redraw in the new colors.
    document.dispatchEvent(new CustomEvent('ng:theme', { detail: next }));
  });
  prefersDark.addEventListener('change', () => paintThemeButton(button));
}

// ---------- Command palette ----------
const EXTRA = [
  { name: 'All tools', hint: 'Browse every tool', href: '/tools/', terms: 'tools all index' },
  { name: 'Lab', hint: 'Experiments and demos', href: '/lab/', terms: 'lab experiments demos' },
  { name: 'Home', hint: 'ng.foo.ng', href: '/', terms: 'home start index' },
];

let dialog;
let input;
let list;
let results = [];
let active = 0;

function paletteResults(query) {
  const q = query.trim().toLowerCase();
  const tools = searchTools(q).map((tool) => ({ name: tool.name, hint: tool.blurb, href: toolUrl(tool) }));
  const extra = EXTRA.filter((entry) => !q || q.split(/\s+/).every((word) => entry.terms.includes(word)));
  return [...tools, ...extra];
}

function renderResults() {
  results = paletteResults(input.value);
  active = Math.min(active, Math.max(results.length - 1, 0));
  list.innerHTML = results.length
    ? results.map((entry, i) => `<li role="none"><a role="option" id="palette-${i}" href="${entry.href}" aria-selected="${i === active}"><b>${escape(entry.name)}</b><small>${escape(entry.hint)}</small></a></li>`).join('')
    : '<li class="empty" role="none">No tools match that.</li>';
  input.setAttribute('aria-activedescendant', results.length ? `palette-${active}` : '');
}

function moveActive(step) {
  if (!results.length) return;
  list.querySelector(`#palette-${active}`)?.setAttribute('aria-selected', 'false');
  active = (active + step + results.length) % results.length;
  const option = list.querySelector(`#palette-${active}`);
  option.setAttribute('aria-selected', 'true');
  option.scrollIntoView({ block: 'nearest' });
  input.setAttribute('aria-activedescendant', option.id);
}

function buildPalette() {
  dialog = document.createElement('dialog');
  dialog.className = 'palette';
  dialog.setAttribute('aria-label', 'Search tools');
  dialog.innerHTML = '<input type="search" placeholder="Search tools…" aria-label="Search tools" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"><ul id="palette-list" role="listbox" aria-label="Tools"></ul>';
  document.body.append(dialog);
  input = dialog.querySelector('input');
  list = dialog.querySelector('ul');
  input.addEventListener('input', () => {
    active = 0;
    renderResults();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Enter' && results[active]) {
      event.preventDefault();
      location.href = results[active].href;
    }
  });
  list.addEventListener('mousemove', (event) => {
    const option = event.target.closest('a[role="option"]');
    if (!option) return;
    const index = Number(option.id.slice('palette-'.length));
    if (index !== active) moveActive(index - active);
  });
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

export function openPalette(query = '') {
  if (!dialog) buildPalette();
  if (dialog.open) return;
  input.value = query;
  active = 0;
  renderResults();
  dialog.showModal();
  input.focus();
}

const isTyping = (el) =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
  el instanceof HTMLSelectElement || el?.isContentEditable;

document.addEventListener('keydown', (event) => {
  const ctrlK = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
  const slash = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTyping(event.target);
  if (ctrlK || slash) {
    event.preventDefault();
    openPalette();
  }
});

renderHeader();
renderFooter();
wireTheme();
document.querySelector('[data-palette]')?.addEventListener('click', () => openPalette());
