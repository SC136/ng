import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cellEdges, colorWarning, contrastRatio, escapeWifi, mailtoPayload, matrixToPath, matrixToSvg, utf8BinaryString, wifiPayload,
} from '../tools/qr/qr.js';

// A fake matrix from rows of "#" (dark) and "." (light).
const fake = (...rows) => ({ size: rows.length, isDark: (r, c) => rows[r][c] === '#' });

test('Wi-Fi payloads follow the WIFI: format', () => {
  assert.equal(wifiPayload({ ssid: 'home', password: 'secret' }), 'WIFI:T:WPA;S:home;P:secret;;');
  assert.equal(wifiPayload({ ssid: 'cafe', auth: 'nopass', password: 'ignored' }), 'WIFI:T:nopass;S:cafe;;');
  assert.equal(wifiPayload({ ssid: 'lab', password: 'k', auth: 'WEP', hidden: true }), 'WIFI:T:WEP;S:lab;P:k;H:true;;');
});

test('Wi-Fi special characters are escaped', () => {
  assert.equal(escapeWifi('a\\b;c,d:e"f'), 'a\\\\b\\;c\\,d\\:e\\"f');
  assert.equal(wifiPayload({ ssid: 'My;Net', password: 'p:a,s"s\\' }), 'WIFI:T:WPA;S:My\\;Net;P:p\\:a\\,s\\"s\\\\;;');
});

test('Wi-Fi errors', () => {
  assert.throws(() => wifiPayload({ password: 'x' }), /network name/);
  assert.throws(() => wifiPayload({ ssid: 'x' }), /password/);
});

test('mailto links encode subject and body', () => {
  assert.equal(mailtoPayload({ to: 'a@b.co' }), 'mailto:a@b.co');
  assert.equal(
    mailtoPayload({ to: ' a@b.co ', subject: 'Hi & bye', body: 'Line 1\nLine 2' }),
    'mailto:a@b.co?subject=Hi%20%26%20bye&body=Line%201%0D%0ALine%202',
  );
  assert.equal(mailtoPayload({ to: 'a@b.co', body: 'ü?' }), 'mailto:a@b.co?body=%C3%BC%3F');
  assert.throws(() => mailtoPayload({ subject: 'x' }), /email address/);
});

test('UTF-8 binary strings have one char per byte', () => {
  assert.equal(utf8BinaryString('abc'), 'abc');
  assert.equal(utf8BinaryString('é'), 'Ã©');
  const rocket = utf8BinaryString('🚀');
  assert.equal(rocket.length, 4);
  assert.deepEqual([...rocket].map((ch) => ch.charCodeAt(0)), [0xf0, 0x9f, 0x9a, 0x80]);
  assert.equal(utf8BinaryString('x'.repeat(70000)).length, 70000);
});

test('matrix to path merges runs and applies the margin', () => {
  const matrix = fake('##.', '.#.', '..#');
  assert.equal(matrixToPath(matrix), 'M0 0h2v1h-2zM1 1h1v1h-1zM2 2h1v1h-1z');
  assert.equal(matrixToPath(matrix, 4), 'M4 4h2v1h-2zM5 5h1v1h-1zM6 6h1v1h-1z');
  assert.equal(matrixToPath(fake('...', '...', '...')), '');
  assert.equal(matrixToPath(fake('###', '###', '###')), 'M0 0h3v1h-3zM0 1h3v1h-3zM0 2h3v1h-3z');
});

test('SVG document has the right viewBox and colors', () => {
  const svg = matrixToSvg(fake('#.', '.#'), { margin: 2, fg: '#112233', bg: '#ffeedd' });
  assert.match(svg, /viewBox="0 0 6 6"/);
  assert.match(svg, /<rect width="6" height="6" fill="#ffeedd"\/>/);
  assert.match(svg, /<path fill="#112233" d="M2 2h1v1h-1zM3 3h1v1h-1z"\/>/);
  assert.throws(() => matrixToSvg(fake('#'), { fg: 'red' }), /#rrggbb/);
  assert.throws(() => matrixToSvg(fake('#'), { bg: '"/><script>' }), /#rrggbb/);
});

test('cell edges cover the canvas exactly', () => {
  assert.deepEqual(cellEdges(4, 8), [0, 2, 4, 6, 8]);
  const edges = cellEdges(29, 512);
  assert.equal(edges.length, 30);
  assert.equal(edges[0], 0);
  assert.equal(edges[29], 512);
  for (let i = 1; i < edges.length; i++) assert.ok(edges[i] - edges[i - 1] >= 17 && edges[i] - edges[i - 1] <= 18);
});

test('contrast and color warnings', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#777777', '#777777'), 1);
  assert.equal(colorWarning('#000000', '#ffffff'), '');
  assert.match(colorWarning('#999999', '#aaaaaa'), /Contrast is only/);
  assert.match(colorWarning('#ffffff', '#000000'), /inverted/);
});
