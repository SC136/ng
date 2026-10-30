import { $, debounce, h, load, save, segmented, setMsg } from '/assets/ui.js';
import { formatSI } from '/assets/units.js';
import {
  LED_PRESETS, NAMES, UNITS, divider, dividerR2, ledResistor, parseList, readValue, seriesParallel, solveOhm,
} from './ohm.js';

const PANELS = { ohm: $('#panel-ohm'), divider: $('#panel-divider'), led: $('#panel-led'), sp: $('#panel-sp') };
const fmt = (value, unit) => formatSI(value, unit);
const stat = (value, label, given = false) => h('div', { class: 'stat' }, h('b', { class: given ? 'given' : null, text: value }), h('span', { text: label }));
const kv = (rows) => h('dl', { class: 'kv' }, rows.flatMap(([term, value]) => [h('dt', { text: term }), h('dd', { text: value })]));

// Reads several fields; returns { values } or { error } for the first problem.
function readFields(fields) {
  const values = {};
  for (const [key, el, label] of fields) {
    el.classList.remove('invalid');
    const result = readValue(el.value, label);
    if (result.error || result.empty) {
      if (result.error) el.classList.add('invalid');
      return { error: result.error || `Enter ${label.toLowerCase()}.` };
    }
    values[key] = result.value;
  }
  return { values };
}

// ---------- Ohm's law ----------
const ohmInputs = { V: $('#ohm-v'), I: $('#ohm-i'), R: $('#ohm-r'), P: $('#ohm-p') };

function updateOhm() {
  const known = {};
  let problem = null;
  for (const [key, el] of Object.entries(ohmInputs)) {
    el.classList.remove('invalid');
    const result = readValue(el.value, NAMES[key]);
    if (result.error) {
      el.classList.add('invalid');
      problem ??= result.error;
    } else if (!result.empty) {
      known[key] = result.value;
    }
  }
  $('#ohm-stats').replaceChildren();
  $('#ohm-formulas').replaceChildren();
  if (problem) {
    setMsg($('#ohm-msg'), problem, 'err');
    return;
  }
  const filled = Object.keys(known).length;
  if (filled < 2) {
    setMsg($('#ohm-msg'), filled ? 'Enter one more value.' : '');
    return;
  }
  try {
    const result = solveOhm(known);
    setMsg($('#ohm-msg'));
    $('#ohm-stats').replaceChildren(
      ...['V', 'I', 'R', 'P'].map((key) => stat(fmt(result[key], UNITS[key]), result.given.includes(key) ? `${NAMES[key]} (given)` : NAMES[key], result.given.includes(key))),
    );
    $('#ohm-formulas').replaceChildren(...Object.values(result.formulas).map((text) => h('li', { text })));
  } catch (error) {
    setMsg($('#ohm-msg'), error.message, 'err');
  }
}

for (const el of Object.values(ohmInputs)) el.addEventListener('input', debounce(updateOhm, 150));
$('#ohm-clear').addEventListener('click', () => {
  for (const el of Object.values(ohmInputs)) el.value = '';
  updateOhm();
  ohmInputs.V.focus();
});

// ---------- Voltage divider ----------
const divInputs = { vin: $('#div-vin'), r1: $('#div-r1'), r2: $('#div-r2'), vout: $('#div-vout') };

function updateDivider() {
  const findR2 = divMode.value === 'r2';
  const fields = [['vin', divInputs.vin, 'Input voltage'], ['r1', divInputs.r1, 'R1']];
  fields.push(findR2 ? ['vout', divInputs.vout, 'Target output voltage'] : ['r2', divInputs.r2, 'R2']);
  for (const el of Object.values(divInputs)) el.classList.remove('invalid');
  const { values, error } = readFields(fields);
  setMsg($('#div-msg'));
  if (error) {
    $('#div-out').replaceChildren(h('p', { class: 'empty', text: 'Fill in the values on the left.' }));
    if (!/^Enter /.test(error)) setMsg($('#div-msg'), error, 'err');
    return;
  }
  try {
    if (findR2) {
      const result = dividerR2(values.vin, values.vout, values.r1);
      $('#div-out').replaceChildren(
        h('div', { class: 'stats' }, stat(fmt(result.r2, 'Ω'), 'Exact R2')),
        h('div', { class: 'table-wrap' },
          h('table', { class: 'data' },
            h('thead', {}, h('tr', {}, ['Series', 'R2', 'Vout', 'Error'].map((text) => h('th', { scope: 'col', text })))),
            h('tbody', {}, result.options.map((o) => h('tr', {},
              h('td', { text: o.series }),
              h('td', { class: 'mono', text: fmt(o.r2, 'Ω') }),
              h('td', { class: 'mono', text: formatSI(o.vout, 'V', { digits: 5 }) }),
              h('td', { class: 'mono', text: `${o.error > 0 ? '+' : ''}${o.error.toFixed(2)}%` }),
            ))),
          ),
        ),
      );
    } else {
      const result = divider(values.vin, values.r1, values.r2);
      $('#div-out').replaceChildren(
        h('div', { class: 'stats' }, stat(formatSI(result.vout, 'V', { digits: 5 }), 'Vout'), stat(fmt(result.current, 'A'), 'Current')),
        kv([
          ['Power in R1', fmt(result.p1, 'W')],
          ['Power in R2', fmt(result.p2, 'W')],
          ['Total power', fmt(result.total, 'W')],
          ['Ratio', `${(values.r2 / (values.r1 + values.r2)).toFixed(4)} (R2 / (R1 + R2))`],
        ]),
      );
    }
  } catch (err) {
    $('#div-out').replaceChildren();
    setMsg($('#div-msg'), err.message, 'err');
  }
}

const divMode = segmented($('#div-mode'), (value) => {
  $('#div-r2-field').hidden = value === 'r2';
  $('#div-vout-field').hidden = value !== 'r2';
  updateDivider();
});
for (const el of Object.values(divInputs)) el.addEventListener('input', debounce(updateDivider, 150));

// ---------- LED resistor ----------
const ledColor = $('#led-color');
const ledVf = $('#led-vf');
ledColor.replaceChildren(
  ...LED_PRESETS.map((preset, i) => h('option', { value: String(i), text: `${preset.name} (${preset.vf} V)` })),
  h('option', { value: 'custom', text: 'Custom' }),
);

function updateLed() {
  const countEl = $('#led-count');
  for (const id of ['#led-supply', '#led-vf', '#led-current', '#led-count']) $(id).classList.remove('invalid');
  const { values, error } = readFields([
    ['supply', $('#led-supply'), 'Supply voltage'],
    ['vf', ledVf, 'Forward voltage'],
    ['current', $('#led-current'), 'Forward current'],
  ]);
  setMsg($('#led-msg'));
  $('#led-out').replaceChildren();
  if (error) {
    if (!/^Enter /.test(error)) setMsg($('#led-msg'), error, 'err');
    return;
  }
  const count = Number(countEl.value);
  try {
    const result = ledResistor({ ...values, count });
    $('#led-out').replaceChildren(
      h('div', { class: 'stats' },
        stat(fmt(result.standard, 'Ω'), 'Use (E24, next up)'),
        stat(result.rating ? `${result.rating} W` : 'Over 10 W', 'Power rating'),
      ),
      kv([
        ['Exact resistance', fmt(result.resistance, 'Ω')],
        ['Voltage across it', fmt(result.drop, 'V')],
        ['Power at exact value', fmt(result.power, 'W')],
        ['Current with E24', fmt(result.actualCurrent, 'A')],
        ['Power with E24', fmt(result.actualPower, 'W')],
      ]),
      h('p', { class: 'hint', text: 'The rating gives at least twice the power the resistor will dissipate.' }),
    );
    if (!result.rating) setMsg($('#led-msg'), 'The resistor would burn more than 5 W. Consider a constant-current driver instead.', 'warn');
  } catch (err) {
    if (/whole number/.test(err.message)) countEl.classList.add('invalid');
    setMsg($('#led-msg'), err.message, 'err');
  }
}

ledColor.addEventListener('change', () => {
  if (ledColor.value !== 'custom') ledVf.value = String(LED_PRESETS[Number(ledColor.value)].vf);
  updateLed();
});
// Typing a forward voltage selects the matching preset, or Custom.
ledVf.addEventListener('input', () => {
  const vf = Number(ledVf.value);
  if (LED_PRESETS[Number(ledColor.value)]?.vf === vf) return;
  const index = LED_PRESETS.findIndex((preset) => preset.vf === vf);
  ledColor.value = index === -1 ? 'custom' : String(index);
});
for (const id of ['#led-supply', '#led-vf', '#led-current', '#led-count']) $(id).addEventListener('input', debounce(updateLed, 150));

// ---------- Series / parallel ----------
const spList = $('#sp-list');

function updateSp() {
  spList.classList.remove('invalid');
  setMsg($('#sp-msg'));
  $('#sp-out').replaceChildren();
  $('#sp-info').textContent = '';
  if (!spList.value.trim()) return;
  try {
    const { values } = parseList(spList.value);
    const result = seriesParallel(values);
    $('#sp-info').textContent = `${result.count} value${result.count === 1 ? '' : 's'}`;
    $('#sp-out').replaceChildren(stat(fmt(result.series, 'Ω'), 'Series'), stat(fmt(result.parallel, 'Ω'), 'Parallel'));
  } catch (err) {
    spList.classList.add('invalid');
    setMsg($('#sp-msg'), err.message, 'err');
  }
}

spList.addEventListener('input', debounce(updateSp, 150));
$('#sp-clear').addEventListener('click', () => {
  spList.value = '';
  updateSp();
  spList.focus();
});

// ---------- Tabs ----------
function show(tab) {
  for (const [name, panel] of Object.entries(PANELS)) panel.hidden = name !== tab;
  save('ohm.tab', tab);
}
const tabs = segmented($('#tab'), show);
const savedTab = load('ohm.tab', 'ohm');
if (Object.hasOwn(PANELS, savedTab)) {
  tabs.value = savedTab;
  show(savedTab);
}

updateOhm();
updateDivider();
updateLed();
updateSp();
