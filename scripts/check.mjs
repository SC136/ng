// Static checks for the site. Run: node scripts/check.mjs            (whole site)
//                                   node scripts/check.mjs --tool json (one tool)
// - local href/src references resolve to real files
// - tool pages follow the page skeleton in docs/CONVENTIONS.md
// - ids that main.js looks up, and ids that labels/aria/data-copy point at, exist
// - registry, tool folders and test files line up
// - logic modules stay free of DOM globals; every script parses
// - only allowlisted external hosts are loaded
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../assets/tools.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const onlyTool = argv.includes('--tool') ? argv[argv.indexOf('--tool') + 1] : null;
if (onlyTool && !TOOLS.some((tool) => tool.slug === onlyTool)) {
  console.error(`"${onlyTool}" is not in assets/tools.js`);
  process.exit(1);
}

const LOADABLE_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com']);
const problems = [];
const rel = (file) => relative(ROOT, file).split('\\').join('/');
const report = (file, message) => problems.push(`${rel(file)}: ${message}`);
const read = (file) => readFileSync(file, 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules' || name === '.claude') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const inScope = (file) => !onlyTool || rel(file).startsWith(`tools/${onlyTool}/`) || rel(file) === `tests/${onlyTool}.test.mjs`;
const files = walk(ROOT).filter(inScope);
const isLab = (file) => rel(file).startsWith('lab/') && rel(file) !== 'lab/index.html';

// ---------- Local references ----------
const SHORT_LINKS = new Set(Object.keys(JSON.parse(read(join(ROOT, 'links.json')))).map((slug) => slug.toLowerCase()));

function resolveLocal(fromFile, ref) {
  const clean = ref.split(/[?#]/)[0];
  if (!clean) return true;
  // "/gh" or "/gh/anything" is served by 404.html as a short link.
  const first = clean.startsWith('/') ? clean.split('/')[1]?.toLowerCase() : null;
  if (first && SHORT_LINKS.has(first) && !existsSync(join(ROOT, first))) return true;
  let target = clean.startsWith('/') ? join(ROOT, clean) : join(dirname(fromFile), clean);
  try {
    target = decodeURIComponent(target);
  } catch {}
  if (clean.endsWith('/')) return existsSync(join(target, 'index.html'));
  if (existsSync(target)) return statSync(target).isFile() || existsSync(join(target, 'index.html'));
  return existsSync(`${target}.html`);
}

const SKIP_REF = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\$\{)/i;

for (const file of files.filter((f) => extname(f) === '.html')) {
  const html = read(file);
  for (const match of html.matchAll(/\s(?:href|src|poster)\s*=\s*(["'])(.*?)\1/gi)) {
    const ref = match[2].trim();
    if (!ref || SKIP_REF.test(ref) || ref.includes('${')) continue;
    if (!resolveLocal(file, ref)) report(file, `broken local reference "${ref}"`);
  }
  if (isLab(file)) continue;
  // External resources that get loaded (not plain links people click).
  for (const match of html.matchAll(/<(script|link|img|iframe|source|video|audio)\b[^>]*?\s(?:src|href)\s*=\s*(["'])(https?:)?\/\/([^/"']+)/gi)) {
    const tag = match[0];
    if (/^<link\b/i.test(tag) && /\brel\s*=\s*["']?(?:canonical|me|author)\b/i.test(tag)) continue;
    if (!LOADABLE_HOSTS.has(match[4].toLowerCase())) report(file, `loads from a host that isn't allowlisted: ${match[4]}`);
  }
}

// ---------- JavaScript ----------
for (const file of files.filter((f) => ['.js', '.mjs'].includes(extname(f)) && !isLab(f))) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) report(file, `syntax error\n${(check.stderr || '').trim().split('\n').slice(0, 6).join('\n')}`);
  const code = read(file);
  for (const match of code.matchAll(/\b(?:fetch|import)\s*\(\s*(["'`])(https?:)?\/\/([^/"'`]+)/g)) {
    report(file, `network call to ${match[3]}: tools must work offline`);
  }
  for (const match of code.matchAll(/\bfrom\s+(["'])([^"']+)\1/g)) {
    const spec = match[2];
    if (/^https?:/.test(spec)) report(file, `imports from the network: ${spec}`);
    else if (spec.startsWith('.') || spec.startsWith('/')) {
      const target = spec.startsWith('/') ? join(ROOT, spec) : join(dirname(file), spec);
      if (!existsSync(target)) report(file, `import "${spec}" does not resolve`);
    }
  }
}

// ---------- Tool pages ----------
const toolDirs = existsSync(join(ROOT, 'tools'))
  ? readdirSync(join(ROOT, 'tools')).filter((name) => statSync(join(ROOT, 'tools', name)).isDirectory())
  : [];
if (!onlyTool) {
  for (const dir of toolDirs) {
    if (!TOOLS.some((tool) => tool.slug === dir)) report(join(ROOT, 'tools', dir), 'folder is not registered in assets/tools.js');
  }
}

const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
// Rough: blanks out string literals so words inside them ("PDF document") don't count as code.
const stripStrings = (code) => code.replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, '""');
const idsIn = (html) => [...html.matchAll(/\sid\s*=\s*(["'])([^"']+)\1/g)].map((m) => m[2]);

for (const tool of TOOLS.filter((t) => !onlyTool || t.slug === onlyTool)) {
  const dir = join(ROOT, 'tools', tool.slug);
  const page = join(dir, 'index.html');
  const main = join(dir, 'main.js');
  const logic = join(dir, `${tool.slug}.js`);
  const testFile = join(ROOT, 'tests', `${tool.slug}.test.mjs`);
  const missing = [page, main, logic, testFile].filter((file) => !existsSync(file));
  for (const file of missing) report(file, 'missing');
  if (missing.includes(page)) continue;

  const html = read(page);
  const need = [
    [/<html lang="en">/, '<html lang="en">'],
    [new RegExp(`<title>${tool.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "(?:'|&#39;|&apos;)")} · ng\\.foo\\.ng</title>`), `<title>${tool.name} · ng.foo.ng</title>`],
    [/<meta name="description" content="[^"]{20,}">/, 'a meta description (20+ characters)'],
    [/<link rel="icon" href="\/assets\/favicon\.svg"/, 'the favicon link'],
    [/<script src="\/assets\/theme\.js"><\/script>/, '<script src="/assets/theme.js">'],
    [/<link rel="stylesheet" href="\/assets\/site\.css">/, 'the site.css link'],
    [/<script type="module" src="\/assets\/shell\.js"><\/script>/, 'the shell.js module script'],
    [/<script type="module" src="\.\/main\.js"><\/script>/, 'the ./main.js module script'],
    [/<div data-shell="header"><\/div>/, '<div data-shell="header"></div>'],
    [/<div data-shell="footer"><\/div>/, '<div data-shell="footer"></div>'],
    [/<main class="tool" id="main">/, '<main class="tool" id="main">'],
    [/class="eyebrow"/, 'an .eyebrow line'],
  ];
  for (const [pattern, label] of need) if (!pattern.test(html)) report(page, `missing ${label}`);
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
  if (h1s.length !== 1) report(page, `needs exactly one <h1>, found ${h1s.length}`);
  if (/\balert\(|\bconfirm\(|\bprompt\(/.test(html)) report(page, 'uses alert/confirm/prompt');
  if (/\sstyle\s*=\s*"[^"]*(?:#[0-9a-f]{3,8}\b|rgb\()/i.test(html)) report(page, 'hardcodes a color in a style attribute; use CSS variables');

  const ids = idsIn(html);
  const idSet = new Set(ids);
  for (const id of ids.filter((id, i) => ids.indexOf(id) !== i)) report(page, `duplicate id "${id}"`);
  for (const m of html.matchAll(/\sfor\s*=\s*(["'])([^"']+)\1/g)) if (!idSet.has(m[2])) report(page, `label for="${m[2]}" has no matching id`);
  for (const m of html.matchAll(/\saria-(?:controls|describedby|labelledby)\s*=\s*(["'])([^"']+)\1/g)) {
    for (const id of m[2].split(/\s+/)) if (!idSet.has(id)) report(page, `aria reference "${id}" has no matching id`);
  }
  for (const m of html.matchAll(/\sdata-copy\s*=\s*(["'])#([^"']+)\1/g)) if (!idSet.has(m[2])) report(page, `data-copy="#${m[2]}" has no matching id`);

  if (existsSync(main)) {
    const code = stripComments(read(main));
    if (!code.includes(`./${tool.slug}.js`)) report(main, `should import its logic from ./${tool.slug}.js`);
    const used = new Set();
    for (const m of code.matchAll(/(?:\$\$?|querySelector(?:All)?)\(\s*(["'`])#([A-Za-z][\w-]*)/g)) used.add(m[2]);
    for (const m of code.matchAll(/getElementById\(\s*(["'`])([\w-]+)\1/g)) used.add(m[2]);
    for (const id of used) if (!idSet.has(id)) report(main, `looks up #${id}, which index.html doesn't have`);
    if (/\balert\(|\bconfirm\(|\bprompt\(/.test(code)) report(main, 'uses alert/confirm/prompt');
    if (/\.innerHTML\s*=(?!=)/.test(code) && !/escapeHtml/.test(code)) report(main, 'sets innerHTML without using escapeHtml; prefer textContent or h()');
  }
  if (existsSync(logic)) {
    const code = stripComments(read(logic));
    const dom = stripStrings(code).match(/\b(document|window|localStorage|sessionStorage|navigator|HTMLElement)\b/);
    if (dom) report(logic, `logic module uses "${dom[1]}"; keep DOM code in main.js`);
    if (/from\s+["']\/assets\/ui\.js["']/.test(code)) report(logic, 'logic module imports ui.js; it must stay DOM-free');
  }
}

if (problems.length) {
  console.log(`${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const problem of problems) console.log(`- ${problem}`);
  process.exit(1);
}
console.log(`All checks passed${onlyTool ? ` for ${onlyTool}` : ''} (${files.length} files).`);
