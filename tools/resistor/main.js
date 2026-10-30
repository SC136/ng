import { $, debounce, h, load, save, segmented, setMsg } from '/assets/ui.js';
import { formatSI } from '/assets/units.js';
import {
  bandRoles, colorByName, decodeBands, describeRange, describeValue, encodeValue, optionsFor, parseResistance,
  roleLabel, seriesFor, tolerancesFor,
} from './resistor.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const pickers = $('#pickers');
const findPanel = $('#find-panel');
const valueInput = $('#value');
const toleranceSelect = $('#tolerance');
const tempcoSelect = $('#tempco');
const findMsg = $('#find-msg');

const DEFAULT_BANDS = {
  4: ['yellow', 'violet', 'red', 'gold'],
  5: ['brown', 'black', 'black', 'red', 'brown'],
  6: ['brown', 'black', 'black', 'red', 'brown', 'brown'],
};

let count = [4, 5, 6].includes(load('resistor.count', 4)) ? load('resistor.count', 4) : 4;
let bands = DEFAULT_BANDS[count].slice();

function meaning(color, role) {
  if (role === 'digit') return String(color.digit);
  if (role === 'multiplier') return color.multiplier >= 1 ? `×${formatSI(color.multiplier).replace(' ', '')}` : `×${color.multiplier}`;
  if (role === 'tolerance') return `±${color.tolerance}%`;
  return `${color.tempco} ppm/K`;
}

function renderPickers() {
  const roles = bandRoles(count);
  pickers.replaceChildren(
    ...roles.map((role, i) => h('fieldset', { class: 'band-pick' },
      h('legend', { text: roleLabel(role, i, count) }),
      h('div', { class: 'swatches' },
        optionsFor(role, count).map((color) => {
          const swatch = h('span', { class: color.hex ? 'swatch' : 'swatch none', 'aria-hidden': 'true' });
          if (color.hex) swatch.style.background = color.hex;
          return h('label', { class: 'pick' },
            h('input', {
              type: 'radio', name: `band-${i}`, value: color.name, checked: bands[i] === color.name,
              onchange: () => {
                bands[i] = color.name;
                update();
              },
            }),
            swatch,
            h('span', { text: color.name }),
            h('small', { text: meaning(color, role) }),
          );
        }),
      ),
    )),
  );
}

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

function drawResistor() {
  const roles = bandRoles(count);
  const root = svg('svg', { viewBox: '0 0 360 100', role: 'img', 'aria-label': `Resistor with bands ${bands.join(', ')}` });
  root.append(
    svg('line', { class: 'lead', x1: 4, y1: 50, x2: 356, y2: 50 }),
    svg('rect', { class: 'body', x: 60, y: 20, width: 240, height: 60, rx: 22, fill: '#d8c095' }),
  );
  // Value bands sit together on the left; tolerance (and tempco) are set apart on the right.
  const mainCount = roles.filter((role) => role === 'digit' || role === 'multiplier').length;
  roles.forEach((role, i) => {
    const color = colorByName(bands[i]);
    if (!color || !color.hex) return;
    let x = 92 + i * 26;
    if (i >= mainCount) x = (count === 6 ? 232 : 252) + (i - mainCount) * 28;
    root.append(svg('rect', { class: 'band', x, y: 20, width: 13, height: 60, fill: color.hex }));
  });
  $('#drawing').replaceChildren(root);
}

function row(term, value) {
  return [h('dt', { text: term }), h('dd', { text: value })];
}

function update() {
  drawResistor();
  setMsg($('#status'));
  try {
    const result = decodeBands(bands);
    const series = seriesFor(result.ohms);
    $('#result').textContent = describeValue({ ...result, tempco: null });
    $('#details').replaceChildren(
      ...row('Range', describeRange(result)),
      ...(result.tempco != null ? row('Tempco', `${result.tempco} ppm/K`) : []),
      ...row('E-series', series.length ? series.join(', ') : 'None, not a standard value'),
      ...row('Bands', bands.map((name) => (name === 'none' ? 'no band' : name)).join(' · ')),
    );
  } catch (error) {
    $('#result').textContent = '';
    $('#details').replaceChildren();
    setMsg($('#status'), error.message, 'err');
  }
}

function fillSelects() {
  const current = decodeSafe()?.tolerance || Number(toleranceSelect.value) || (count === 4 ? 5 : 1);
  const list = tolerancesFor(count);
  toleranceSelect.replaceChildren(...list.map((t) => h('option', { value: t, text: `±${t}%` })));
  toleranceSelect.value = String(list.includes(current) ? current : count === 4 ? 5 : 1);
  if (!tempcoSelect.options.length) {
    tempcoSelect.replaceChildren(...optionsFor('tempco').map((c) => h('option', { value: c.tempco, text: `${c.tempco} ppm/K (${c.name})` })));
    tempcoSelect.value = '100';
  }
  $('#tempco-field').hidden = count !== 6;
}

function decodeSafe() {
  try {
    return decodeBands(bands);
  } catch {
    return null;
  }
}

function find() {
  valueInput.classList.remove('invalid');
  setMsg(findMsg);
  if (!valueInput.value.trim()) return;
  const parsed = parseResistance(valueInput.value);
  if (!parsed.ok) {
    valueInput.classList.add('invalid');
    setMsg(findMsg, parsed.error, 'err');
    return;
  }
  try {
    const encoded = encodeValue(parsed.value, { count, tolerance: Number(toleranceSelect.value), tempco: Number(tempcoSelect.value) });
    bands = encoded.bands;
    if (!encoded.exact) {
      const nearest = encoded.series ? `the nearest ${encoded.series} value` : 'the nearest value bands can show';
      setMsg(findMsg, `${formatSI(parsed.value, 'Ω', { digits: 8 })} needs more significant digits than ${count} bands have. Showing ${nearest}, ${formatSI(encoded.ohms, 'Ω')}.`, 'warn');
    }
    renderPickers();
    update();
  } catch (error) {
    valueInput.classList.add('invalid');
    setMsg(findMsg, error.message, 'err');
  }
}

// Keeps the same value when the band count changes, if the new count can show it.
function convertBands(newCount) {
  const current = decodeSafe();
  count = newCount;
  if (!current) {
    bands = DEFAULT_BANDS[count].slice();
    return;
  }
  const tolerances = tolerancesFor(count);
  const tolerance = tolerances.includes(current.tolerance) ? current.tolerance : count === 4 ? 5 : 1;
  try {
    bands = encodeValue(current.ohms, { count, tolerance, tempco: current.tempco ?? (Number(tempcoSelect.value) || 100) }).bands;
  } catch {
    bands = DEFAULT_BANDS[count].slice();
  }
}

const mode = segmented($('#mode'), (value) => {
  const finding = value === 'find';
  findPanel.hidden = !finding;
  pickers.hidden = finding;
  $('#input-title').textContent = finding ? 'Value' : 'Bands';
  if (finding) {
    const current = decodeSafe();
    if (current) {
      valueInput.value = formatSI(current.ohms, 'Ω');
      if (tolerancesFor(count).includes(current.tolerance)) toleranceSelect.value = String(current.tolerance);
      if (current.tempco != null) tempcoSelect.value = String(current.tempco);
    }
    valueInput.focus();
    find();
  } else {
    setMsg(findMsg);
  }
});

const countSeg = segmented($('#count'), (value) => {
  convertBands(Number(value));
  save('resistor.count', count);
  fillSelects();
  if (mode.value === 'find') find();
  renderPickers();
  update();
});
countSeg.value = String(count);

valueInput.addEventListener('input', debounce(find, 150));
toleranceSelect.addEventListener('change', find);
tempcoSelect.addEventListener('change', find);

fillSelects();
renderPickers();
update();
