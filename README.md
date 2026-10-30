# ng.foo.ng

Swar's toolbox, lab and short links, served by GitHub Pages at **https://ng.foo.ng**.

- **Tools** (`/tools/`): JSON, Base64, URL, JWT, hashes, diff, regex, text, UUIDs, passwords, QR codes, timestamps, cron, color, images, bits, resistors, Ohm's law and LiPo batteries. Everything runs in the browser; nothing is uploaded.
- **Lab** (`/lab/`): front-end experiments.
- **Short links**: `ng.foo.ng/<slug>` redirects to whatever `links.json` says. Extra path is passed through, so `ng.foo.ng/gh/ng` goes to `github.com/SC136/ng`.

## Add a short link

Add a line to [`links.json`](links.json) (lowercase letters, digits and hyphens) and push. That's it: there's no build step. GitHub Pages serves `404.html` for unknown paths, and that page looks the path up in `links.json` and redirects. You can also use the helper at `/tools/links/`, which validates the slug and opens the GitHub editor.

## Work on it locally

Needs Node 20 or newer. No dependencies to install.

```bash
npm run serve   # http://localhost:4173, behaves like GitHub Pages (404.html, /dir/ redirects)
npm test        # unit tests for every tool's logic
npm run check   # static checks: broken links, page skeleton, element ids, allowed hosts
```

## Add a tool

Read [docs/CONVENTIONS.md](docs/CONVENTIONS.md), copy the pattern in `tools/base64/`, register the tool in `assets/tools.js`, and make `npm test` and `npm run check` pass.

## Credits

- QR codes use [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (MIT), loaded from cdnjs.
- Fonts: Instrument Serif, Inter and JetBrains Mono from Google Fonts.
