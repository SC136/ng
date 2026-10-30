// Renders the tool grid with live search. Used by the home page and /tools/.
import { CATEGORIES, TOOLS, searchTools, toolUrl } from './tools.js';

const escape = (text) => String(text).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const card = (tool) => `
  <a class="tool-card" href="${toolUrl(tool)}">
    <strong>${escape(tool.name)}</strong>
    <span>${escape(tool.blurb)}</span>
    <code>/tools/${tool.slug}</code>
  </a>`;

/**
 * Fills `root` with tool cards grouped by category, filtered by the search `input`.
 * Pressing Enter in the search box opens the top result.
 */
export function mountToolGrid(root, input) {
  let results = TOOLS;

  function render() {
    const query = input?.value.trim() ?? '';
    results = searchTools(query);
    if (!query) {
      root.innerHTML = CATEGORIES.map((category) => {
        const tools = TOOLS.filter((tool) => tool.cat === category.id);
        if (!tools.length) return '';
        return `<section class="cat" aria-labelledby="cat-${category.id}"><h3 id="cat-${category.id}">${escape(category.name)}</h3><div class="tool-grid">${tools.map(card).join('')}</div></section>`;
      }).join('');
      return;
    }
    root.innerHTML = results.length
      ? `<section class="cat" aria-label="Search results"><h3>${results.length} match${results.length === 1 ? '' : 'es'}</h3><div class="tool-grid">${results.map(card).join('')}</div></section>`
      : `<p class="empty">No tools match “${escape(query)}”. Try a different word, like “hash” or “battery”.</p>`;
  }

  input?.addEventListener('input', render);
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && input.value.trim() && results[0]) location.href = toolUrl(results[0]);
  });
  render();
}
