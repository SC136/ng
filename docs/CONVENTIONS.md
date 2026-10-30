# Conventions for ng.foo.ng

Static site on GitHub Pages (`.nojekyll`, no build step, no framework, no npm dependencies).
Every tool runs entirely in the browser. **The reference implementation is `tools/base64/` + `tests/base64.test.mjs` — copy its patterns.**

## Files per tool
- `tools/<slug>/index.html` — the page. Copy the `<head>` and body skeleton from `tools/base64/index.html` exactly; change title, description, eyebrow category, h1, lede, and the tool UI.
- `tools/<slug>/main.js` — DOM wiring only (ES module). Imports helpers from `/assets/ui.js` and logic from `./<slug>.js`.
- `tools/<slug>/<slug>.js` — pure logic (ES module). No `document`, `window`, `localStorage`, `navigator`. Everything worth testing lives here. Globals like `crypto`, `TextEncoder`, `Intl`, `URL`, `atob` are fine (Node 20+ has them).
- `tests/<slug>.test.mjs` — `node:test` + `node:assert/strict` tests of the logic module. Use reference vectors from RFCs/specs where they exist; cover edge cases and error messages.
- Extra files (e.g. a worker) may go in `tools/<slug>/`.

Only write inside your own `tools/<slug>/` folder and `tests/<slug>*.test.mjs`. **Never edit `assets/`, other tools, or root files.** If you need something shared, say so in your report.

Page `<title>` must be exactly `<Name> · ng.foo.ng` and the single `<h1>` must be `<Name>`, where Name is the tool's `name` in `assets/tools.js`. Eyebrow: `<p class="eyebrow"><a href="/tools/">Tools</a> / <Category name></p>`.

## Shared JS — `/assets/ui.js` (main.js only)
`$`, `$$`, `h(tag, props, ...children)`, `escapeHtml`, `debounce(fn, ms)`, `toast(msg, 'info'|'err')`, `copyText(text)`, `download(data, filename, type)`, `readFile(file, as)`, `setMsg(el, text, 'ok'|'warn'|'err'|'')`, `segmented(groupEl, onChange)` → `{ value }`, `dropzone(el, onFiles, { accept, multiple })`, `load(key, fallback)` / `save(key, value)` (options only, keys prefixed `<slug>.`), `hashParam(name)`, `formatBytes`.
Copy buttons need no code: `<button class="btn sm" type="button" data-copy="#some-id">Copy</button>` copies that element's value/text; `data-copy-text="literal"` copies a literal.

## Pure helpers (logic modules import with relative paths so Node can load them)
- `../../assets/units.js`: `parseSI("4k7") → 4700`, `formatSI(4700, 'Ω') → "4.7 kΩ"`, `formatBytes`.
- `../../assets/eseries.js`: `SERIES.E6…E192`, `nearestPreferred(value, 'E24', 'nearest'|'up'|'down')`, `seriesContaining(value)`, `SERIES_TOLERANCE`.
- `../../assets/links.js`: short-link logic (`SITE`, `EDIT_URL`, `validateSlug`, `validateTarget`, `listLinks`, `resolveShortLink`).

## Shared CSS — `/assets/site.css`
Layout: `.tool` (main), `.tool-head`, `.eyebrow`, `.lede`, `.grid-2` / `.grid-3` (stack under 860px), `.full` (span all grid columns), `.stack`, `.row` (`.row.end`), `.spacer`.
Panes: `.pane` > `.pane-head` (`.pane-title` label + buttons) + `.pane-body` (`.flush` for an edge-to-edge textarea/.out) + optional `.pane-foot`.
Controls: `.btn` (`.primary`, `.ghost`, `.sm`, `.icon`), `.seg` with `<button type="button" data-value aria-pressed>`, `.field` (`<label class="field"><span>Label</span><input></label>` or `<div class="field"><label for>…`), `.hint`, `.check` (checkbox label), `.mono`, `.invalid` (on inputs), `.dropzone`.
Output: `.out` (mono pre-wrap block), `.kv` (`<dl>` key/value), `.table-wrap` > `table.data`, `.badge` (`.ok .warn .err .info`), `.msg` (`.ok .warn .err`; hidden when empty), `.stats` > `.stat` (`<b>value</b><span>label</span>`), `.chip`, `.kbd`, `.swatch`, `.empty`, `mark`, `.ok-text .warn-text .err-text .muted`.
Tool-specific styles go in a small `<style>` block in the page, using the CSS variables (`--paper --paper-2 --paper-3 --card --field --ink --ink-2 --ink-3 --line --line-2 --accent --accent-text --accent-soft --indigo --ok --warn --err` and their `-soft` variants, `--radius`, `--font-mono`, `--font-display`). Never hardcode UI colors (data colors like resistor bands are fine). Must look right in light and dark themes.

## Rules
- No network calls, no analytics, no external scripts (the QR tool's pinned library is the one exception).
- Never persist what people type or drop. Persisting UI options with `load`/`save` is fine.
- Accessibility: every control has a label or `aria-label`; live results use `role="status"`/`aria-live` where useful; keyboard works; meaning never relies on color alone.
- Works at 360 px wide with no horizontal page scroll.
- Errors appear inline (`.msg.err`) in plain language. Never `alert`/`confirm`/`prompt`.
- Debounce expensive input handlers (~150 ms); cap pathological input sizes with a clear message.
- UI text: sentence case, short, plain, no exclamation marks, no emoji.
- User-provided strings go in via `textContent` / `h()`; if you build HTML strings, escape with `escapeHtml`.
- Style: 2-space indent, semicolons, single quotes, JSDoc on exported logic functions, comments only where intent isn't obvious.

## Verify before you finish
```
node --test tests/<slug>.test.mjs
node scripts/check.mjs --tool <slug>
```
Both must pass. Don't run a browser, don't install packages, don't commit or push.
