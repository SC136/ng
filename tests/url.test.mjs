import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UrlError, decodeUrl, encodeUrl, parseUrl, rebuildUrl } from '../tools/url/url.js';

const errorOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('expected an error');
};

test('component mode matches encodeURIComponent', () => {
  const text = 'a b&c=d/é?#✓🚀!\'()*~';
  assert.equal(encodeUrl(text, 'component'), encodeURIComponent(text));
  assert.equal(decodeUrl(encodeURIComponent(text), 'component'), text);
});

test('full URL mode matches encodeURI and keeps reserved escapes when decoding', () => {
  const text = 'https://example.com/a path/é?q=1 2&r=ü#frag';
  assert.equal(encodeUrl(text, 'full'), encodeURI(text));
  assert.equal(decodeUrl(encodeURI(text), 'full'), text);
  assert.equal(decodeUrl('/a%2Fb%20c%3Fd%23e', 'full'), decodeURI('/a%2Fb%20c%3Fd%23e'));
  assert.equal(decodeUrl('/a%2Fb%20c', 'full'), '/a%2Fb c');
});

test('form mode uses + for spaces and encodes !\'()~', () => {
  assert.equal(encodeUrl("a b!'()~*-._", 'form'), 'a+b%21%27%28%29%7E*-._');
  assert.equal(encodeUrl('a b&c', 'form'), new URLSearchParams({ x: 'a b&c' }).toString().slice(2));
  assert.equal(decodeUrl('a+b%2Bc', 'form'), 'a b+c');
  assert.equal(decodeUrl('a+b', 'component'), 'a+b');
});

test('multi-byte characters decode across escape runs, lowercase hex is fine', () => {
  assert.equal(decodeUrl('%e2%9c%93 and %F0%9F%9A%80'), '✓ and 🚀');
  assert.equal(decodeUrl('100%25'), '100%');
  assert.equal(decodeUrl(''), '');
});

test('malformed % sequences report their position', () => {
  const cases = [
    ['abc%', 4, /"%" at position 4/],
    ['ab%2', 3, /"%2" at position 3/],
    ['a%zz', 2, /"%zz" at position 2/],
    ['ok%20%G1', 6, /two hex digits/],
  ];
  for (const [text, position, pattern] of cases) {
    const error = errorOf(() => decodeUrl(text));
    assert.ok(error instanceof UrlError);
    assert.equal(error.position, position, text);
    assert.match(error.message, pattern);
  }
});

test('invalid UTF-8 reports where it starts', () => {
  const lone = errorOf(() => decodeUrl('ab%FFcd'));
  assert.equal(lone.position, 3);
  assert.match(lone.message, /isn't valid UTF-8/);
  assert.equal(errorOf(() => decodeUrl('x%E2%9C')).position, 2);
  assert.equal(errorOf(() => decodeUrl('%41%C3%28')).position, 4);
  assert.throws(() => decodeUrl('%ED%A0%80'), /UTF-8/);
});

test('lone surrogates can\'t be encoded', () => {
  const error = errorOf(() => encodeUrl('ab\uD800c'));
  assert.equal(error.position, 3);
  assert.match(error.message, /surrogate/);
  assert.equal(encodeUrl('🚀'), '%F0%9F%9A%80');
});

test('parses a URL into its parts and params', () => {
  const { kind, parts, params } = parseUrl('https://user:p%40ss@Example.com:8080/a/b?x=1&y=two+words&x=3#top');
  assert.equal(kind, 'url');
  assert.deepEqual(parts, {
    protocol: 'https:', username: 'user', password: 'p@ss', host: 'example.com', port: '8080',
    path: '/a/b', query: '?x=1&y=two+words&x=3', hash: '#top', origin: 'https://example.com:8080',
  });
  assert.deepEqual(params, [['x', '1'], ['y', 'two words'], ['x', '3']]);
  assert.equal(parseUrl('https://example.com').parts.port, '');
  assert.equal(parseUrl('mailto:someone@example.com').parts.origin, '');
});

test('parses a bare query string', () => {
  assert.deepEqual(parseUrl('?a=1&b=%20x').params, [['a', '1'], ['b', ' x']]);
  assert.deepEqual(parseUrl('a=1&b').params, [['a', '1'], ['b', '']]);
  assert.equal(parseUrl('a=1').kind, 'query');
});

test('explains input that isn\'t a URL', () => {
  assert.match(errorOf(() => parseUrl('example.com/path')).message, /no scheme.*https:\/\/example\.com\/path/);
  assert.match(errorOf(() => parseUrl('just words')).message, /isn't a URL/);
  assert.match(errorOf(() => parseUrl('  ')).message, /Paste a URL/);
});

test('rebuilds the URL from edited params', () => {
  const base = 'https://example.com/p?old=1#h';
  assert.equal(rebuildUrl(base, [['a', '1'], ['b', 'two words & more']]), 'https://example.com/p?a=1&b=two+words+%26+more#h');
  assert.equal(rebuildUrl(base, []), 'https://example.com/p#h');
  assert.equal(rebuildUrl(base, [['', ''], ['k', '']]), 'https://example.com/p?k=#h');
  assert.equal(rebuildUrl('?x=1', [['y', '2']]), '?y=2');
  assert.equal(rebuildUrl('?x=1', []), '');
  const url = 'https://example.com/?q=%C3%A9t%C3%A9&n=1';
  assert.equal(rebuildUrl(url, parseUrl(url).params), url);
});
