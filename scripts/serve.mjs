// Local preview server that behaves like GitHub Pages:
// /dir → 301 /dir/, /dir/ → /dir/index.html, /page → /page.html, anything else → 404.html with status 404.
// Run: node scripts/serve.mjs   (PORT=8080 node scripts/serve.mjs to change the port)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.pdf': 'application/pdf',
};

const kind = async (path) => {
  try {
    const info = await stat(path);
    return info.isFile() ? 'file' : info.isDirectory() ? 'dir' : null;
  } catch {
    return null;
  }
};

async function send(res, status, file, headers = {}) {
  const body = await readFile(file);
  res.writeHead(status, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  const target = resolve(ROOT, `.${pathname}`);
  const hidden = pathname.split('/').some((part) => part.startsWith('.'));
  if ((target !== ROOT && !target.startsWith(ROOT + sep)) || hidden) {
    await send(res, 404, join(ROOT, '404.html'));
    return;
  }
  const type = await kind(target);
  if (type === 'file') return send(res, 200, target);
  if (type === 'dir') {
    if (!pathname.endsWith('/')) {
      res.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end();
      return;
    }
    if ((await kind(join(target, 'index.html'))) === 'file') return send(res, 200, join(target, 'index.html'));
  } else if ((await kind(`${target}.html`)) === 'file') {
    return send(res, 200, `${target}.html`);
  }
  if ((await kind(join(ROOT, '404.html'))) === 'file') return send(res, 404, join(ROOT, '404.html'));
  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
});

server.listen(PORT, '127.0.0.1', () => console.log(`Serving ${ROOT} at http://localhost:${PORT}/`));
