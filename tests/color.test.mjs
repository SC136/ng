import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAMED_COLORS, checkContrast, contrastRatio, formatAll, namesOf, nearestShade, oklchToRgbMapped, parseColor,
  shades, toHex, toHslString, toOklabString, toOklchString,
} from '../tools/color/color.js';

const hexOf = (input) => toHex(parseColor(input));
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label ?? 'value'}: ${actual} is not within ${tolerance} of ${expected}`);

test('#ff0000 converts to every format', () => {
  const out = formatAll(parseColor('#ff0000'));
  assert.equal(out.hex, '#ff0000');
  assert.equal(out.hexAlpha, null);
  assert.equal(out.rgb, 'rgb(255 0 0)');
  assert.equal(out.hsl, 'hsl(0 100% 50%)');
  assert.equal(out.hwb, 'hwb(0 0% 0%)');
  assert.equal(out.oklch, 'oklch(0.628 0.2577 29.23)');
  assert.equal(out.oklab, 'oklab(0.628 0.2249 0.1258)');
  assert.deepEqual(out.names, ['red']);
});

test('named colors: all 148, rebeccapurple and aliases', () => {
  assert.equal(Object.keys(NAMED_COLORS).length, 148);
  assert.equal(hexOf('rebeccapurple'), '#663399');
  assert.equal(hexOf('RebeccaPurple'), '#663399');
  assert.equal(toHslString(parseColor('rebeccapurple')), 'hsl(270 50% 40%)');
  assert.deepEqual(namesOf(parseColor('#00ffff')), ['aqua', 'cyan']);
  assert.deepEqual(namesOf(parseColor('#808080')), ['gray', 'grey']);
  assert.deepEqual(namesOf(parseColor('#123456')), []);
  assert.deepEqual(namesOf(parseColor('#ff000080')), []);
  assert.equal(parseColor('transparent').alpha, 0);
  assert.throws(() => parseColor('reddish'), /isn't a CSS color name/);
});

test('hex variants: 3, 4, 6, 8 digits, with or without #', () => {
  assert.equal(hexOf('#f00'), '#ff0000');
  assert.equal(hexOf('f00'), '#ff0000');
  assert.equal(hexOf('#FF8800'), '#ff8800');
  const short = parseColor('#f008');
  assert.equal(toHex(short), '#ff0000');
  near(short.alpha, 0x88 / 255, 1e-9, 'alpha');
  assert.equal(formatAll(parseColor('#11223380')).hexAlpha, '#11223380');
  assert.throws(() => parseColor('#12345'), /3, 4, 6 or 8 digits/);
  assert.throws(() => parseColor('#ggg'), /3, 4, 6 or 8 digits/);
});

test('rgb() in comma, space and percent syntax', () => {
  assert.equal(hexOf('rgb(255, 0, 0)'), '#ff0000');
  assert.equal(hexOf('rgb(255 0 0)'), '#ff0000');
  assert.equal(hexOf('rgba(0, 128, 255, 0.5)'), '#0080ff');
  assert.equal(hexOf('rgb(100% 50% 0%)'), '#ff8000');
  assert.equal(parseColor('rgba(0, 0, 0, 0.25)').alpha, 0.25);
  assert.equal(parseColor('rgb(0 0 0 / 40%)').alpha, 0.4);
  assert.equal(hexOf('rgb(300 -5 0)'), '#ff0000');
  assert.throws(() => parseColor('rgb(1, 2)'), /needs 3 values/);
  assert.throws(() => parseColor('rgb(1, 2, 3 / 0.5)'), /Mix of commas/);
  assert.throws(() => parseColor('rgb(a b c)'), /isn't a valid channel value/);
});

test('hsl() and hwb() with angle units', () => {
  assert.equal(hexOf('hsl(120, 100%, 25%)'), '#008000');
  assert.equal(hexOf('hsl(120 100% 25%)'), '#008000');
  assert.equal(hexOf('hsla(0.5turn 100% 50% / 1)'), '#00ffff');
  assert.equal(hexOf('hsl(3.14159265rad 100% 50%)'), '#00ffff');
  assert.equal(hexOf('hsl(-120 100% 50%)'), '#0000ff');
  assert.equal(hexOf('hwb(0 0% 0%)'), '#ff0000');
  assert.equal(hexOf('hwb(240 20% 20%)'), '#3333cc');
  assert.equal(hexOf('hwb(0 60% 60%)'), '#808080');
  assert.throws(() => parseColor('hsl(10% 50% 50%)'), /can't be a percentage/);
});

test('oklch() and oklab() round trip and percentages', () => {
  assert.equal(hexOf('oklch(0.628 0.2577 29.23)'), '#ff0000');
  assert.equal(parseColor('oklch(0.628 0.2577 29.23)').mapped, false);
  assert.equal(hexOf('oklch(62.8% 64.4% 29.23deg)'), '#ff0000');
  assert.equal(hexOf('oklab(0.628 0.2249 0.1258)'), '#ff0000');
  assert.equal(hexOf('oklch(1 0 0)'), '#ffffff');
  assert.equal(hexOf('oklch(0 0 none)'), '#000000');
  assert.equal(toOklchString(parseColor('white')), 'oklch(1 0 0)');
  assert.equal(toOklabString(parseColor('black')), 'oklab(0 0 0)');
  for (const hex of ['#663399', '#3b82f6', '#10b981', '#f59e0b', '#777777']) {
    assert.equal(hexOf(toOklchString(parseColor(hex))), hex, hex);
  }
});

test('out-of-gamut OKLCH is gamut-mapped by reducing chroma', () => {
  const vivid = parseColor('oklch(0.7 0.4 145)');
  assert.equal(vivid.mapped, true);
  for (const channel of [vivid.r, vivid.g, vivid.b]) assert.ok(channel >= 0 && channel <= 1);
  // Lightness and hue are kept.
  const back = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(toOklchString(vivid));
  near(Number(back[1]), 0.7, 0.01, 'lightness');
  near(Number(back[3]), 145, 1.5, 'hue');
  assert.ok(Number(back[2]) < 0.4);
  assert.equal(oklchToRgbMapped({ L: 0.5, C: 0.05, h: 200 }).mapped, false);
});

test('alpha appears in every format when below 1', () => {
  const out = formatAll(parseColor('rgb(255 0 0 / 0.5)'));
  assert.equal(out.hex, '#ff0000');
  assert.equal(out.hexAlpha, '#ff000080');
  assert.equal(out.rgb, 'rgb(255 0 0 / 0.5)');
  assert.equal(out.hsl, 'hsl(0 100% 50% / 0.5)');
  assert.match(out.oklch, / \/ 0\.5\)$/);
  assert.equal(parseColor('#000000').alpha, 1);
  assert.equal(parseColor('rgb(0 0 0 / 150%)').alpha, 1);
});

test('WCAG contrast ratios', () => {
  near(contrastRatio(parseColor('black'), parseColor('white')), 21, 1e-9, 'black/white');
  near(contrastRatio(parseColor('white'), parseColor('black')), 21, 1e-9, 'white/black');
  near(contrastRatio(parseColor('#777'), parseColor('#777')), 1, 1e-9, 'same');
  const grey = checkContrast(parseColor('#767676'), parseColor('white'));
  near(grey.ratio, 4.54, 0.005, '#767676 on white');
  assert.equal(grey.ratioText, '4.54:1');
  const pass = Object.fromEntries(grey.levels.map((level) => [level.id, level.pass]));
  assert.deepEqual(pass, { aa: true, 'aa-large': true, aaa: false, 'aaa-large': true, ui: true });
  // #777777 is just under 4.5 and must fail AA, not round up.
  const close = checkContrast(parseColor('#777777'), parseColor('white'));
  assert.ok(close.ratio < 4.5);
  assert.equal(close.levels.find((level) => level.id === 'aa').pass, false);
  assert.equal(close.ratioText, '4.47:1');
});

test('translucent text is composited over the background', () => {
  const ratio = contrastRatio(parseColor('rgb(0 0 0 / 0)'), parseColor('white'));
  near(ratio, 1, 1e-9, 'invisible text');
  const half = contrastRatio(parseColor('rgb(0 0 0 / 0.5)'), parseColor('white'));
  near(half, contrastRatio(parseColor('#808080'), parseColor('white')), 0.05, 'half black');
});

test('shades: 11 steps from light to dark keeping hue', () => {
  const scale = shades(parseColor('#3b82f6'));
  assert.equal(scale.length, 11);
  assert.deepEqual(scale.map((s) => s.step), [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]);
  for (let i = 1; i < scale.length; i++) assert.ok(scale[i].L < scale[i - 1].L);
  for (const shade of scale) assert.match(shade.hex, /^#[0-9a-f]{6}$/);
  const grays = shades(parseColor('#808080'));
  for (const shade of grays) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(shade.hex.slice(i, i + 2), 16));
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 1, `${shade.hex} should be gray`);
  }
  assert.equal(nearestShade(parseColor('white')), 0);
  assert.equal(nearestShade(parseColor('black')), 10);
});

test('helpful errors', () => {
  assert.throws(() => parseColor(''), /Enter a color/);
  assert.throws(() => parseColor('lab(50 20 30)'), /isn't supported/);
  assert.throws(() => parseColor('rgb(1 2 3 / )'), /Missing alpha/);
  assert.throws(() => parseColor('12 34'), /Not a color/);
  assert.throws(() => parseColor('x'.repeat(500)), /too long/);
});
