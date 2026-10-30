import { $, copyText, debounce, h, hashParam, setMsg } from '/assets/ui.js';
import { checkContrast, formatAll, nearestShade, parseColor, shades, toHex, toRgbString } from './color.js';

const input = $('#color-input');
const picker = $('#color-picker');
const message = $('#color-msg');
const fgInput = $('#fg-input');
const fgPicker = $('#fg-picker');
const bgInput = $('#bg-input');
const bgPicker = $('#bg-picker');
const contrastMsg = $('#contrast-msg');

let current = null;

function showColor() {
  input.classList.remove('invalid');
  setMsg(message);
  let color;
  try {
    color = parseColor(input.value);
  } catch (error) {
    input.classList.add('invalid');
    setMsg(message, error.message, 'err');
    return;
  }
  current = color;
  const out = formatAll(color);
  picker.value = out.hex;
  $('#preview').style.background = toRgbString(color);
  $('#preview').setAttribute('aria-label', `Color preview: ${out.names[0] || out.hexAlpha || out.hex}`);
  $('#gamut-badge').hidden = !color.mapped;
  if (color.mapped) {
    setMsg(message, 'This OKLCH color is outside the sRGB gamut, so its chroma was reduced to the nearest color a screen can show. Lightness and hue are kept.', 'warn');
  }
  $('#out-hex').value = out.hex;
  $('#out-hexa').value = out.hexAlpha || '';
  $('#row-hexa').hidden = !out.hexAlpha;
  $('#out-rgb').value = out.rgb;
  $('#out-hsl').value = out.hsl;
  $('#out-hwb').value = out.hwb;
  $('#out-oklch').value = out.oklch;
  $('#out-oklab').value = out.oklab;
  $('#out-name').value = out.names.join(', ');
  $('#row-name').hidden = !out.names.length;
  showShades(color);
}

function showShades(color) {
  const scale = shades(color);
  const nearest = nearestShade(color);
  $('#shades').replaceChildren(
    ...scale.map((shade, i) => {
      const swatch = h('span', { class: 'chipcolor' });
      swatch.style.background = shade.hex;
      return h(
        'button',
        {
          type: 'button',
          class: 'shade',
          'aria-current': i === nearest ? 'true' : null,
          'aria-label': `${shade.step}: ${shade.hex}${i === nearest ? ', closest to your color' : ''}. Copy`,
          onclick: () => copyText(shade.hex),
        },
        swatch,
        h('span', { text: String(shade.step) }),
        h('small', { text: shade.hex }),
      );
    }),
  );
}

function showContrast() {
  setMsg(contrastMsg);
  let fg;
  let bg;
  for (const field of [fgInput, bgInput]) field.classList.remove('invalid');
  try {
    fg = parseColor(fgInput.value);
  } catch (error) {
    fgInput.classList.add('invalid');
    setMsg(contrastMsg, `Text color: ${error.message}`, 'err');
    return;
  }
  try {
    bg = parseColor(bgInput.value);
  } catch (error) {
    bgInput.classList.add('invalid');
    setMsg(contrastMsg, `Background: ${error.message}`, 'err');
    return;
  }
  fgPicker.value = toHex(fg);
  bgPicker.value = toHex(bg);
  if (bg.alpha < 1) setMsg(contrastMsg, 'The background is translucent, so the ratio assumes it sits on white.', 'warn');
  const result = checkContrast(fg, bg);
  $('#ratio').textContent = result.ratioText;
  $('#levels').replaceChildren(
    ...result.levels.map((level) =>
      h(
        'li',
        {},
        h('span', { class: `badge ${level.pass ? 'ok' : 'err'}`, text: level.pass ? 'Pass' : 'Fail' }),
        h('strong', { text: level.label }),
        h('span', { class: 'muted', text: `${level.min}:1 · ${level.note}` }),
      ),
    ),
  );
  const sample = $('#sample');
  sample.style.background = toRgbString(bg);
  sample.style.color = toRgbString(fg);
}

const showColorSoon = debounce(showColor, 150);
const showContrastSoon = debounce(showContrast, 150);

input.addEventListener('input', showColorSoon);
picker.addEventListener('input', () => {
  input.value = picker.value;
  showColor();
});

fgInput.addEventListener('input', showContrastSoon);
bgInput.addEventListener('input', showContrastSoon);
fgPicker.addEventListener('input', () => {
  fgInput.value = fgPicker.value;
  showContrast();
});
bgPicker.addEventListener('input', () => {
  bgInput.value = bgPicker.value;
  showContrast();
});

$('#swap').addEventListener('click', () => {
  [fgInput.value, bgInput.value] = [bgInput.value, fgInput.value];
  showContrast();
});

function useAs(field) {
  if (!current) return;
  field.value = input.value.trim();
  showContrast();
  field.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#use-fg').addEventListener('click', () => useAs(fgInput));
$('#use-bg').addEventListener('click', () => useAs(bgInput));

$('#random').addEventListener('click', () => {
  const random = crypto.getRandomValues(new Uint8Array(3));
  input.value = `#${Array.from(random, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  showColor();
});

input.value = hashParam('color') || '#3b82f6';
fgInput.value = '#1f2937';
bgInput.value = '#ffffff';
showColor();
showContrast();
