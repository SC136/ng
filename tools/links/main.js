import { $, debounce, h, setMsg } from '/assets/ui.js';
import {
  EDIT_URL, LINKS_FILE, checkLinksData, checkNewLink, displayShort, filterLinks, listLinks, placementHint, qrHref,
} from './links.js';

const search = $('#search');
const list = $('#list');
const slugInput = $('#new-slug');
const urlInput = $('#new-url');

let links = {};
let rows = [];
let loaded = false;

$('#edit').href = EDIT_URL;

function renderList() {
  const shown = filterLinks(rows, search.value);
  $('#count-info').textContent = loaded ? (search.value.trim() ? `${shown.length} of ${rows.length}` : `${rows.length} links`) : '';
  if (!loaded) {
    list.replaceChildren();
    return;
  }
  if (!shown.length) {
    list.replaceChildren(h('li', { class: 'empty', text: rows.length ? 'No links match that search.' : 'There are no links yet.' }));
    return;
  }
  list.replaceChildren(...shown.map((row) => h('li', {},
    h('div', {},
      h('div', { class: 'short', text: displayShort(row.short) }),
      h('div', { class: 'target', text: row.url }),
      row.error ? h('span', { class: 'badge err', text: row.error }) : null,
    ),
    h('div', { class: 'actions' },
      h('button', { class: 'btn sm', type: 'button', 'data-copy-text': row.short, 'aria-label': `Copy short link ${displayShort(row.short)}`, text: 'Copy short link' }),
      h('a', { class: 'btn sm', href: row.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open ${row.url}`, text: 'Open' }),
      h('a', { class: 'btn sm', href: qrHref(row.short), 'aria-label': `QR code for ${displayShort(row.short)}`, text: 'QR' }),
    ),
  )));
}

function showFieldMessage(input, el, result, typed) {
  input.classList.toggle('invalid', typed && !result.ok);
  el.textContent = typed && !result.ok ? result.error : '';
  el.className = typed && !result.ok ? 'hint err-text' : 'hint';
}

function updateNewLink() {
  const result = checkNewLink(slugInput.value, urlInput.value, links);
  showFieldMessage(slugInput, $('#slug-msg'), result.slug, slugInput.value.trim() !== '');
  showFieldMessage(urlInput, $('#url-msg'), result.target, urlInput.value.trim() !== '');
  if (result.slug.ok && slugInput.value.trim()) {
    $('#slug-msg').textContent = loaded ? 'Available.' : 'Looks fine. The list hasn’t loaded, so it may be taken.';
    $('#slug-msg').className = loaded ? 'hint ok-text' : 'hint';
  }
  $('#snippet-box').hidden = !result.ok;
  if (!result.ok) return;
  $('#new-short').textContent = displayShort(result.short);
  $('#snippet').value = result.snippet.line;
  $('#placement').textContent = placementHint(result.snippet);
}

async function loadLinks() {
  try {
    const response = await fetch(LINKS_FILE, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`The server answered ${response.status}.`);
    links = checkLinksData(await response.json());
    rows = listLinks(links);
    loaded = true;
    setMsg($('#load-msg'));
  } catch (error) {
    const reason = error instanceof SyntaxError ? 'links.json isn’t valid JSON.' : error.message;
    setMsg($('#load-msg'), `Couldn’t load the links list. ${reason}`, 'err');
  }
  renderList();
  updateNewLink();
}

search.addEventListener('input', debounce(renderList, 100));
slugInput.addEventListener('input', debounce(updateNewLink, 150));
urlInput.addEventListener('input', debounce(updateNewLink, 150));

list.replaceChildren(h('li', { class: 'empty', text: 'Loading links…' }));
loadLinks();
