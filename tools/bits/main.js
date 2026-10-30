import { $, debounce, h, load, save, segmented, setMsg } from '/assets/ui.js';
import {
  FLOATS, WIDTHS, bitsOf, bytesOf, describeFloat, describeFloatBits, floatClassLabel, groupDigits, isExactlyStored, leadingZeros,
  parseFloatHex, parseFloatInput, parseInteger, popcount, toBase, toggleBit, trailingZeros, twosComplement,
} from './bits.js';

const num = $('#num');
const baseSelect = $('#base');
const customBase = $('#custom-base');
const numMsg = $('#num-msg');
const widthMsg = $('#width-msg');
const floatDec = $('#float-dec');
const floatHex = $('#float-hex');
const floatMsg = $('#float-msg');

// value: the parsed BigInt (null when the input is empty or invalid); radix: the base it was read in.
const state = { value: null, radix: 10, floatBits: null };

const width = segmented($('#width'), (value) => {
  save('bits.width', Number(value));
  renderWidth();
});
const floatKind = segmented($('#float-kind'), (value) => {
  save('bits.float', value);
  // Keep the decimal the person typed and re-store it in the new size.
  if (floatDec.value.trim()) fromFloatDecimal();
  else if (state.floatBits !== null) renderFloat(describeFloatBits(BigInt.asUintN(FLOATS[value].bits, state.floatBits), value));
});

const currentWidth = () => Number(width.value);

function selectedBase() {
  if (baseSelect.value === 'auto') return 'auto';
  if (baseSelect.value === 'custom') return Math.trunc(Number(customBase.value));
  return Number(baseSelect.value);
}

// ---------- Integer ----------

const outputs = {
  bin: [$('#out-bin'), $('#copy-bin')],
  oct: [$('#out-oct'), $('#copy-oct')],
  dec: [$('#out-dec'), $('#copy-dec')],
  hex: [$('#out-hex'), $('#copy-hex')],
};

function setOutput(id, shown, raw) {
  const [output, button] = outputs[id];
  output.value = shown;
  button.dataset.copyText = raw;
}

function clearInteger() {
  for (const id of ['bin', 'oct', 'dec', 'hex']) setOutput(id, '', '');
  state.value = null;
  renderWidth();
}

function renderInteger() {
  num.classList.remove('invalid');
  customBase.classList.remove('invalid');
  setMsg(numMsg);
  if (!num.value.trim()) {
    clearInteger();
    return;
  }
  let parsed;
  try {
    parsed = parseInteger(num.value, selectedBase());
  } catch (error) {
    (/base must be/.test(error.message) ? customBase : num).classList.add('invalid');
    setMsg(numMsg, error.message, 'err');
    clearInteger();
    return;
  }
  state.value = parsed.value;
  state.radix = parsed.base;
  const bin = toBase(parsed.value, 2);
  const oct = toBase(parsed.value, 8);
  const dec = toBase(parsed.value, 10);
  const hex = toBase(parsed.value, 16);
  setOutput('bin', groupDigits(bin, 4), bin);
  setOutput('oct', groupDigits(oct, 3), oct);
  setOutput('dec', groupDigits(dec, 3, ','), dec);
  setOutput('hex', groupDigits(hex, 4), hex);
  if (baseSelect.value === 'auto' && parsed.base !== 10) setMsg(numMsg, `Read as ${{ 2: 'binary', 8: 'octal', 16: 'hex' }[parsed.base]} from the prefix.`, '');
  renderWidth();
}

function renderBitGrid(container, bits, { label, onToggle, cellClass }) {
  const total = bits.length;
  const perRow = Math.min(16, total);
  const rows = [];
  for (let start = 0; start < total; start += perRow) {
    const high = total - 1 - start;
    const low = Math.max(0, high - perRow + 1);
    const cells = bits.slice(start, start + perRow).map((bit, offset) => {
      const index = high - offset;
      const extra = cellClass ? cellClass(index) : null;
      return h(
        'button',
        {
          type: 'button',
          class: extra ? `bit ${extra.cls}` : 'bit',
          'aria-pressed': String(bit === 1),
          'aria-label': `${label} ${index}${extra ? `, ${extra.name}` : ''}: ${bit}`,
          title: `Bit ${index}${extra ? ` (${extra.name})` : ''}`,
          onclick: () => onToggle(index),
        },
        String(bit),
        extra ? h('small', { 'aria-hidden': 'true', text: extra.letter }) : null,
      );
    });
    const row = h('div', { class: 'bitcells' }, cells);
    row.style.setProperty('--cols', String(perRow));
    rows.push(h('div', { class: 'bitrow' }, h('span', { class: 'bitrow-label', text: `Bits ${high}–${low}` }), row));
  }
  // Keep keyboard focus on the same bit after re-rendering.
  const focused = container.contains(document.activeElement) ? [...container.querySelectorAll('.bit')].indexOf(document.activeElement) : -1;
  container.replaceChildren(...rows);
  if (focused >= 0) container.querySelectorAll('.bit')[focused]?.focus();
}

const hexBytes = (list) => list.map((b) => b.toString(16).padStart(2, '0')).join(' ');

function renderWidth() {
  const w = currentWidth();
  setMsg(widthMsg);
  const value = state.value ?? 0n;
  const t = twosComplement(value, w);
  if (state.value !== null && !t.fits) {
    setMsg(widthMsg, `Overflow: ${toBase(value, 10)} doesn't fit in ${w} bits, signed or unsigned. Showing only the low ${w} bits.`, 'warn');
  }
  $('#tc-hex').textContent = state.value === null ? '' : `0x${groupDigits(t.pattern.toString(16).padStart(w / 4, '0'), 4, '_')}`;
  $('#tc-signed').textContent = state.value === null ? '' : t.signed.toString();
  $('#tc-unsigned').textContent = state.value === null ? '' : t.unsigned.toString();
  $('#tc-range').textContent = `${t.min} to ${t.max} (unsigned 0 to ${t.umax})`;
  $('#popcount').textContent = String(popcount(t.pattern));
  $('#clz').textContent = String(leadingZeros(t.pattern, w));
  $('#ctz').textContent = String(trailingZeros(t.pattern, w));
  const bytes = bytesOf(t.pattern, w);
  $('#bytes-be').value = hexBytes(bytes);
  $('#bytes-le').value = hexBytes([...bytes].reverse());
  renderBitGrid($('#bit-grid'), bitsOf(t.pattern, w), {
    label: 'Bit',
    onToggle: (index) => {
      const pattern = toggleBit(t.pattern, index, w);
      const next = twosComplement(pattern, w);
      // Negative inputs stay signed; everything else reads as unsigned.
      writeInteger(value < 0n ? next.signed : next.unsigned);
    },
  });
}

/** Puts a value back in the input, in the base the person was using. */
function writeInteger(value) {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const radix = state.radix;
  const prefix = baseSelect.value === 'auto' ? { 2: '0b', 8: '0o', 16: '0x' }[radix] || '' : '';
  num.value = `${negative ? '-' : ''}${prefix}${magnitude.toString(radix)}`;
  renderInteger();
}

// ---------- Float ----------

function renderFloat(d) {
  const kind = floatKind.value;
  const spec = FLOATS[kind];
  state.floatBits = d.bits;
  const f = d.fields;
  $('#f-sign-bits').textContent = d.signBits;
  $('#f-sign-val').textContent = f.sign ? '1 = negative' : '0 = positive';
  $('#f-exp-bits').textContent = d.exponentBits;
  $('#f-exp-val').textContent = {
    zero: `0 (zero)`,
    subnormal: `0 = subnormal, 2^${f.unbiased}`,
    normal: `${f.exponent} − ${spec.bias} = ${f.unbiased}, so 2^${f.unbiased}`,
    infinity: `all ones = infinity or NaN`,
    nan: `all ones = infinity or NaN`,
  }[f.kind];
  $('#f-man-bits').textContent = d.mantissaBits;
  $('#f-man-val').textContent = {
    zero: 'all zeros',
    subnormal: `0.fraction (no implicit 1), 0x${f.mantissa.toString(16)}`,
    normal: `1.fraction (implicit leading 1), 0x${f.mantissa.toString(16)}`,
    infinity: 'all zeros = infinity',
    nan: `non-zero = NaN payload 0x${f.mantissa.toString(16)}`,
  }[f.kind];
  const badge = $('#f-class');
  badge.textContent = floatClassLabel(f);
  badge.className = `badge ${f.kind === 'normal' ? 'ok' : f.kind === 'subnormal' ? 'warn' : f.kind === 'nan' ? 'err' : 'info'}`;
  $('#f-hex').value = `0x${d.hex}`;
  $('#f-stored').value = d.storedText;
  $('#f-exact').textContent = d.exact;
  if (d.overflow) {
    setMsg(floatMsg, `That is too large for ${spec.label}, so it is stored as ${f.sign ? '-' : ''}Infinity.`, 'warn');
  } else if (d.rounded) {
    setMsg(floatMsg, `${spec.label} can't hold this number exactly, so it stores the nearest value it can. See the exact value below.`, 'warn');
  }
  renderBitGrid($('#float-grid'), bitsOf(d.bits, spec.bits), {
    label: 'Float bit',
    cellClass: (index) => {
      if (index === spec.bits - 1) return { cls: 'sign', name: 'sign', letter: 'S' };
      if (index >= spec.mantissaBits) return { cls: 'exp', name: 'exponent', letter: 'E' };
      return { cls: 'man', name: 'mantissa', letter: 'M' };
    },
    onToggle: (index) => {
      const bits = toggleBit(d.bits, index, spec.bits);
      floatHex.value = bits.toString(16).padStart(spec.bits / 4, '0');
      fromFloatHex();
    },
  });
}

function clearFloat() {
  state.floatBits = null;
  for (const id of ['#f-sign-bits', '#f-sign-val', '#f-exp-bits', '#f-exp-val', '#f-man-bits', '#f-man-val', '#f-exact']) $(id).textContent = '';
  $('#f-class').textContent = '';
  $('#f-class').className = 'badge';
  $('#f-hex').value = '';
  $('#f-stored').value = '';
  $('#float-grid').replaceChildren();
}

function fromFloatDecimal() {
  floatDec.classList.remove('invalid');
  floatHex.classList.remove('invalid');
  setMsg(floatMsg);
  if (!floatDec.value.trim()) {
    floatHex.value = '';
    clearFloat();
    return;
  }
  let value;
  try {
    value = parseFloatInput(floatDec.value);
  } catch (error) {
    floatDec.classList.add('invalid');
    setMsg(floatMsg, error.message, 'err');
    clearFloat();
    return;
  }
  const d = describeFloat(value, floatKind.value);
  // Compare digit for digit: 0.1 is already rounded once it is a JS number, even for float64.
  d.rounded = Number.isFinite(value) && !isExactlyStored(floatDec.value, d.exact);
  d.overflow = Number.isFinite(value) && d.fields.kind === 'infinity';
  floatHex.value = d.hex;
  renderFloat(d);
}

function fromFloatHex() {
  floatDec.classList.remove('invalid');
  floatHex.classList.remove('invalid');
  setMsg(floatMsg);
  if (!floatHex.value.trim()) {
    floatDec.value = '';
    clearFloat();
    return;
  }
  let bits;
  try {
    bits = parseFloatHex(floatHex.value, floatKind.value);
  } catch (error) {
    floatHex.classList.add('invalid');
    setMsg(floatMsg, error.message, 'err');
    clearFloat();
    return;
  }
  const d = describeFloatBits(bits, floatKind.value);
  floatDec.value = d.storedText;
  renderFloat(d);
}

// ---------- Wiring ----------

num.addEventListener('input', debounce(renderInteger, 150));
baseSelect.addEventListener('change', () => {
  $('#custom-field').hidden = baseSelect.value !== 'custom';
  save('bits.base', baseSelect.value);
  renderInteger();
});
customBase.addEventListener('input', debounce(() => {
  save('bits.custom', customBase.value);
  renderInteger();
}, 150));
floatDec.addEventListener('input', debounce(fromFloatDecimal, 150));
floatHex.addEventListener('input', debounce(fromFloatHex, 150));

const savedWidth = load('bits.width', 32);
width.value = String(WIDTHS.includes(savedWidth) ? savedWidth : 32);
floatKind.value = load('bits.float', 'f32') === 'f64' ? 'f64' : 'f32';
const savedBase = load('bits.base', 'auto');
baseSelect.value = ['auto', '2', '8', '10', '16', 'custom'].includes(savedBase) ? savedBase : 'auto';
customBase.value = String(load('bits.custom', '36'));
$('#custom-field').hidden = baseSelect.value !== 'custom';

num.value = baseSelect.value === 'auto' || baseSelect.value === '10' ? '-42' : '';
floatDec.value = '0.1';
renderInteger();
fromFloatDecimal();
